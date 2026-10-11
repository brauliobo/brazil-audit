//! How each voter of a section was identified, read from the urns' logs (the release's logs archives: a zip of .jez zips (2026) or
//! .logjez 7z files (2022), each with a logd.dat).
//!
//!   logscan <day dd/mm/yyyy> <out dir> <logs zip>...
//!
//! One TSV per archive: state, city (TSE code), zone, section, votes, bio, man, nor, run, hv, hm, hn
//!   bio = voters enabled by fingerprint; man = enabled by the poll worker after trying their fingerprint; nor = enabled by the poll
//!   worker without trying one (no fingerprint registered); run = longest streak of consecutive `man` voters; hv/hm/hn = all/`man`/`nor`
//!   voters per hour of the machine's clock, 05h to 19h. Only the voting events of `day` count (one per "O voto do eleitor foi computado").
//! LOGSCAN_THREADS (default 4) is the number of archives' sections read at once; the machine is usually shared.
//!
//!   logscan pack <day dd/mm/yyyy> <election key> <out dir> <logs zip>...   per archive: <key>-logpack-<uf>-<nn>.pack + .idx (see pack.rs)
//!   logscan show <.idx> <.pack> <zone> <section>                           prints the stored voters and events of a section

mod pack;

use anyhow::{anyhow, bail, Context, Result};
use rayon::prelude::*;
use regex::Regex;
use std::fs::{self, File};
use std::io::{Cursor, Read, Write};
use std::path::Path;
use std::sync::LazyLock;
use zip::ZipArchive;

const FIRST: usize = 5;
const HOURS: usize = 15;

// only the four messages that tell how a voter was identified (the rest of a log is ~95% of its lines); the logs are latin1
const WAITING: [&[u8]; 2] = [b"Aguardando digita\xe7\xe3o do identificador do eleitor", b"Aguardando digita\xe7\xe3o do t\xedtulo"];
const TRY: &[u8] = b"Solicita digital. Tentativa";
const BIOMETRIC: &[u8] = b"Tipo de habilita\xe7\xe3o do eleitor [biom\xe9trica]\t";
const VOTE: &[u8] = b"O voto do eleitor foi computado\t";

static NAME: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^files/([a-z]{2})-(\d{5})-(\d{4})-(\d{4})-").unwrap()); // 2026: the state is in the name
static NAME22: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"o\d{5}-(\d{5})(\d{4})(\d{4})\.logjez$").unwrap()); // 2022: the state is in the archive's name
static STATE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"-([a-z]{2})-\d+\.zip$").unwrap());

#[derive(Debug, Default, PartialEq)]
struct Section {
    votes: u32,
    bio: u32,
    man: u32,
    nor: u32,
    run: u32,
    hv: [u32; HOURS],
    hm: [u32; HOURS],
    hn: [u32; HOURS],
}

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Waiting,
    Try,
    Biometric,
    Vote,
}

fn digits(b: &[u8]) -> bool {
    b.iter().all(u8::is_ascii_digit)
}

/// `DD/MM/YYYY HH:MM:SS` + the rest of the line -> (date, seconds of the day, rest), None for a line that does not start with a stamp.
fn stamp(line: &[u8]) -> Option<(&[u8], u32, &[u8])> {
    if line.len() < 19 || line[10] != b' ' || line[13] != b':' || line[16] != b':' || line[2] != b'/' || line[5] != b'/' {
        return None;
    }
    if !(digits(&line[..2]) && digits(&line[3..5]) && digits(&line[6..10]) && digits(&line[11..13]) && digits(&line[14..16]) && digits(&line[17..19])) {
        return None;
    }
    let two = |i: usize| ((line[i] - b'0') * 10 + line[i + 1] - b'0') as u32;
    Some((&line[..10], two(11) * 3600 + two(14) * 60 + two(17), &line[19..]))
}

/// `DD/MM/YYYY HH:MM:SS<TAB>INFO<TAB><id><TAB>VOTA<TAB><message>` -> (date, hour, what the message says), None for any other line.
fn event(line: &[u8]) -> Option<(&[u8], usize, Kind)> {
    let (date, secs, rest) = stamp(line)?;
    let rest = rest.strip_prefix(b"\tINFO\t")?;
    let id = rest.iter().position(|b| !b.is_ascii_digit()).filter(|&n| n > 0)?;
    let msg = rest[id..].strip_prefix(b"\tVOTA\t")?;
    let kind = if WAITING.iter().any(|w| msg.starts_with(w)) {
        Kind::Waiting
    } else if msg.starts_with(TRY) {
        Kind::Try
    } else if msg.starts_with(BIOMETRIC) {
        Kind::Biometric
    } else if msg.starts_with(VOTE) {
        Kind::Vote
    } else {
        return None;
    };
    Some((date, secs as usize / 3600, kind))
}

/// Counts the voters of `day` in a section's log by how the machine enabled them.
fn scan(log: &[u8], day: &[u8]) -> Section {
    let mut s = Section::default();
    let (mut attempts, mut bio, mut run) = (false, false, 0);
    for (date, hour, kind) in log.split(|&b| b == b'\n').filter_map(event) {
        match kind {
            Kind::Waiting => (attempts, bio) = (false, false),
            Kind::Try => attempts = true,
            Kind::Biometric => bio = true,
            Kind::Vote if date == day => {
                let h = hour.saturating_sub(FIRST).min(HOURS - 1);
                s.votes += 1;
                s.hv[h] += 1;
                if bio {
                    s.bio += 1;
                    run = 0;
                } else if attempts {
                    s.man += 1;
                    s.hm[h] += 1;
                    run += 1;
                    s.run = s.run.max(run);
                } else {
                    s.nor += 1;
                    s.hn[h] += 1;
                    run = 0;
                }
            }
            Kind::Vote => {}
        }
    }
    s
}

fn read_log(data: Vec<u8>, name: &str) -> Result<Vec<u8>> {
    let mut log = Vec::new();
    if name.ends_with(".logjez") {
        let len = data.len() as u64;
        let mut archive = sevenz_rust::SevenZReader::new(Cursor::new(data), len, sevenz_rust::Password::empty())?;
        let mut found = false; // a machine that never started has an empty logd.dat: no events, not a missing file
        archive.for_each_entries(|entry, reader| {
            found = entry.name() == "logd.dat";
            if found {
                reader.read_to_end(&mut log)?;
            }
            Ok(!found)
        })?;
        if !found {
            bail!("{name}: no logd.dat");
        }
    } else {
        ZipArchive::new(Cursor::new(data))?.by_name("logd.dat")?.read_to_end(&mut log)?;
    }
    Ok(log)
}

/// (state, city, zone, section) of an archive entry; the 2022 names do not hold the state, the archive's does.
fn place(path: &str, name: &str) -> Result<[String; 4]> {
    let part = |c: &regex::Captures, i: usize| c[i].to_string();
    if name.ends_with(".logjez") {
        let state = STATE.captures(path).ok_or_else(|| anyhow!("{path}: no state in the archive's name"))?;
        let c = NAME22.captures(name).ok_or_else(|| anyhow!("{name}: not a 2022 log name"))?;
        Ok([part(&state, 1), part(&c, 1), part(&c, 2), part(&c, 3)])
    } else {
        let c = NAME.captures(name).ok_or_else(|| anyhow!("{name}: not a 2026 log name"))?;
        Ok([part(&c, 1), part(&c, 2), part(&c, 3), part(&c, 4)])
    }
}

fn hours(h: &[u32; HOURS]) -> String {
    h.iter().map(u32::to_string).collect::<Vec<_>>().join(",")
}

/// The logd.dat of the archive's entry `index` (a .jez zip or a .logjez 7z).
fn entry_log(archive: &mut ZipArchive<File>, index: usize, name: &str) -> Result<Vec<u8>> {
    let mut data = Vec::new();
    archive.by_index(index)?.read_to_end(&mut data)?;
    read_log(data, name).with_context(|| name.to_string())
}

/// Runs `f(archive, entry index, entry name)` on every log of the archive, a few at a time, in the archive's order.
fn map_logs<T: Send>(path: &str, f: impl Fn(&mut ZipArchive<File>, usize, &str) -> Result<T> + Sync) -> Result<Vec<T>> {
    let mut outer = ZipArchive::new(File::open(path).with_context(|| path.to_string())?)?;
    let entries: Vec<(usize, String)> = (0..outer.len())
        .map(|i| Ok((i, outer.by_index_raw(i)?.name().to_string())))
        .collect::<Result<Vec<_>>>()?
        .into_iter()
        .filter(|(_, n)| n.ends_with(".jez") || n.ends_with(".logjez"))
        .collect();
    entries
        .par_iter()
        .map_init(|| ZipArchive::new(File::open(path).expect("archive opened a moment ago")).expect("archive read a moment ago"), |zip, (i, name)| f(zip, *i, name))
        .collect()
}

fn row(path: &str, name: &str, archive: &mut ZipArchive<File>, index: usize, day: &[u8]) -> Result<String> {
    let s = scan(&entry_log(archive, index, name)?, day);
    let [state, city, zone, section] = place(path, name)?;
    Ok(format!("{state}\t{city}\t{zone}\t{section}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}", s.votes, s.bio, s.man, s.nor, s.run, hours(&s.hv), hours(&s.hm), hours(&s.hn)))
}

fn archive(path: &str, day: &[u8], out: &Path) -> Result<usize> {
    let rows = map_logs(path, |zip, i, name| row(path, name, zip, i, day))?;
    let stem = Path::new(path).file_stem().and_then(|s| s.to_str()).ok_or_else(|| anyhow!("{path}: no file name"))?;
    let tmp = out.join(format!("{stem}.tsv.tmp")); // a partial file is never taken for a result
    File::create(&tmp)?.write_all((rows.join("\n") + "\n").as_bytes())?;
    fs::rename(&tmp, out.join(format!("{stem}.tsv")))?;
    Ok(rows.len())
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let threads = std::env::var("LOGSCAN_THREADS").map_or(Ok(4), |v| v.parse()).context("LOGSCAN_THREADS")?;
    rayon::ThreadPoolBuilder::new().num_threads(threads).build_global()?;
    if let [cmd, rest @ ..] = args.as_slice() {
        match cmd.as_str() {
            "pack" => return pack::run(rest),
            "show" => return pack::show(rest),
            _ => {}
        }
    }
    let [day, out, archives @ ..] = args.as_slice() else { bail!("usage: logscan <day dd/mm/yyyy> <out dir> <logs zip>... | pack ... | show ...") };
    fs::create_dir_all(out)?;
    for path in archives {
        println!("{path} {}", archive(path, day.as_bytes(), Path::new(out))?);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: &[u8] = b"04/10/2026";

    fn line(date: &str, time: &str, msg: &[u8]) -> Vec<u8> {
        [format!("{date} {time}\tINFO\t67305985\tVOTA\t").as_bytes(), msg, b"\n"].concat()
    }

    fn log(events: &[(&str, &str, &[u8])]) -> Vec<u8> {
        events.iter().flat_map(|(d, t, m)| line(d, t, m)).collect()
    }

    const WAIT: &[u8] = b"Aguardando digita\xe7\xe3o do identificador do eleitor";
    const TRIES: &[u8] = b"Solicita digital. Tentativa 1 de 4";
    const BIO: &[u8] = b"Tipo de habilita\xe7\xe3o do eleitor [biom\xe9trica]\tx";
    const DONE: &[u8] = b"O voto do eleitor foi computado\t1";

    #[test]
    fn tells_how_each_voter_was_enabled() {
        let s = scan(&log(&[
            ("04/10/2026", "08:00:01", WAIT), ("04/10/2026", "08:00:05", BIO), ("04/10/2026", "08:01:00", DONE), // fingerprint
            ("04/10/2026", "08:02:00", WAIT), ("04/10/2026", "08:02:10", TRIES), ("04/10/2026", "08:03:00", DONE), // manual
            ("04/10/2026", "09:02:00", WAIT), ("04/10/2026", "09:03:00", DONE), // no fingerprint tried
        ]), DAY);
        assert_eq!((s.votes, s.bio, s.man, s.nor, s.run), (3, 1, 1, 1, 1));
        assert_eq!((s.hv[3], s.hv[4], s.hm[3], s.hn[4]), (2, 1, 1, 1));
    }

    #[test]
    fn counts_the_longest_streak_of_manual_releases() {
        let manual = [("04/10/2026", "10:00:00", WAIT), ("04/10/2026", "10:00:05", TRIES), ("04/10/2026", "10:01:00", DONE)];
        let bio = [("04/10/2026", "10:02:00", WAIT), ("04/10/2026", "10:02:05", BIO), ("04/10/2026", "10:03:00", DONE)];
        let s = scan(&log(&[&manual[..], &manual, &bio, &manual].concat()), DAY);
        assert_eq!((s.man, s.run), (3, 2));
    }

    #[test]
    fn ignores_other_days_other_messages_and_clamps_the_hours() {
        let s = scan(&log(&[
            ("03/10/2026", "09:00:00", DONE), ("04/10/2026", "09:00:00", b"Impressao da zeresima"), ("04/10/2026", "03:00:00", DONE), ("04/10/2026", "22:00:00", DONE),
        ]), DAY);
        assert_eq!((s.votes, s.hv[0], s.hv[HOURS - 1]), (2, 1, 1));
        assert_eq!(scan(b"not a log\n\n04/10/2026 08:00:00\tINFO\tx\tVOTA\tO voto do eleitor foi computado\t", DAY), Section::default());
    }

    #[test]
    fn titles_are_waited_for_too() {
        let s = scan(&log(&[("04/10/2026", "08:00:00", TRIES), ("04/10/2026", "08:00:10", b"Aguardando digita\xe7\xe3o do t\xedtulo"), ("04/10/2026", "08:01:00", DONE)]), DAY);
        assert_eq!((s.nor, s.man), (1, 0));
    }

    #[test]
    fn places_both_name_formats() {
        let p = place("logs/2026-logs-rr-01.zip", "files/rr-03000-0004-0011-4e45-o03220rr0300000040011-log.jez").unwrap();
        assert_eq!(p, ["rr", "03000", "0004", "0011"]);
        let p = place("logs22/2022-logs-ac-01.zip", "o00406-0111200060046.logjez").unwrap();
        assert_eq!(p, ["ac", "01112", "0006", "0046"]);
        assert!(place("x.zip", "other.jez").is_err());
    }
}
