//! `logscan pack`: a compact, seekable copy of each urn's log of the voting day, for the browser.
//!
//! The release's archives are zips of zips (GitHub release assets cannot be read by a browser at all, see README "Section logs"), so
//! per archive this writes two files that a static host serves with HTTP Range:
//!   <key>-logpack-<uf>-<nn>.pack  the sections' blobs, one after the other, sorted by (zone, section, city); each blob is its own raw
//!                                 deflate stream (DecompressionStream('deflate-raw') in the browser), so one section = one Range request
//!   <key>-logpack-<uf>-<nn>.idx   one raw deflate stream: "LGX1", u32 sections, u32 templates, the templates (u16 length + UTF-8) and
//!                                 one 16-byte record per blob (u32 city, u16 zone, u16 section, u32 offset, u32 length), all little endian
//! A blob (varints are LEB128, zz = zigzag) holds the voting day only, as the machine's own clock recorded it:
//!   varint voters, varint events, varint lines of other days (not stored)
//!   voters x zz(gap)    seconds from the previous voter's vote to this voter's enabling
//!   voters x varint(dur) seconds from enabling to the vote being computed
//!   voters x u8         flags: how the voter was enabled (bits 0-1: 0 fingerprint, 1 poll worker after trying a fingerprint, 2 poll
//!                       worker without trying one; the rule of `scan`), bit 2 a correction on the confirmation screen, bits 3-7 the
//!                       fingerprint attempts (at most 31)
//!   voters x u8         keys pressed that were not accepted (at most 255)
//!   events x (varint seconds since the previous event, varint template, params): every line that is not part of a voter's ordinary
//!                       cycle (wait, identification, fingerprint, enabling, one confirmation per office, vote computed), with its time.
//!                       Template 0 is a literal (varint length + UTF-8 "LEVEL|MODULE|text"); n > 0 is templates[n - 1], a text with
//!                       one `{}` per number taken out of the message (a varint each; `{N}` is a number zero padded to N digits). Numbers of 10 or more digits (poll workers' and
//!                       voters' ids) are never stored: they become `#`.
//! The vote itself is not in a log (the machine writes "Voto confirmado para [Senador]", never the number), so neither is it here.

use crate::{entry_log, map_logs, place, stamp, BIOMETRIC, TRY, VOTE, WAITING};
use anyhow::{anyhow, bail, ensure, Context, Result};
use flate2::{read::DeflateDecoder, write::DeflateEncoder, Compression};
use rayon::prelude::*;
use regex::Regex;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{LazyLock, Mutex};

const MAGIC: &[u8; 4] = b"LGX1";
const LITERAL: u64 = 0;
const COMMON: usize = 50; // a message shape seen fewer times in an archive is stored as a literal (serials and the like are unique per urn)

const ENABLED: &[u8] = b"Eleitor foi habilitado\t";
const CONFIRM: &[u8] = b"Voto confirmado para [";
const WRONG: &[u8] = b"Tecla indevida pressionada\t";
const CORRECT: &[u8] = b"Eleitor corrigiu na tela de confirma\xe7\xe3o de candidato\t";
// lines of an ordinary cycle that only say how the voter was identified: the voter's flags keep what matters of them
const NOISE: [&[u8]; 5] = [b"Capturada a digital. Tentativa", b"N\xfamero de tentativas de reconhecimento do dedo", b"Foto do eleitor apresentada", b"Identificador do eleitor digitado pelo mes\xe1rio", b"Identificador digitado pelo mes\xe1rio foi"];

static HOLE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\{(\d?)\}").unwrap());
static ARCHIVE:LazyLock<Regex> = LazyLock::new(|| Regex::new(r"-([a-z]{2})-(\d+)\.zip$").unwrap());

#[derive(Clone, Copy, PartialEq)]
enum Line {
    Wait,
    Try,
    Bio,
    Done,
    Enabled,
    Confirm,
    Wrong,
    Correct,
    Noise,
    Other,
}

#[derive(Debug, Default, PartialEq)]
struct Voter {
    gap: i64,
    dur: u32,
    flags: u8,
    wrong: u8,
}

#[derive(Debug, PartialEq)]
struct Event {
    secs: u32,
    template: usize,
    params: Vec<u32>,
}

#[derive(Debug, Default, PartialEq)]
struct SectionLog {
    voters: Vec<Voter>,
    events: Vec<Event>,
    other_days: u32,
}

/// The message shapes met while reading (`LEVEL|MODULE|text with {}`), numbered in the order they were first met.
#[derive(Default)]
struct Templates {
    ids: HashMap<String, usize>,
    list: Vec<String>,
}

impl Templates {
    fn id(&mut self, key: String) -> usize {
        *self.ids.entry(key.clone()).or_insert_with(|| {
            self.list.push(key);
            self.list.len() - 1
        })
    }
}

struct Item<'a> {
    secs: u32,
    level: &'a [u8],
    module: &'a [u8],
    msg: &'a [u8],
    line: Line,
}

fn latin1(b: &[u8]) -> String {
    b.iter().map(|&c| c as char).collect()
}

/// (level, module, the message with what follows it) of the rest of a line after its stamp.
fn fields(rest: &[u8]) -> Option<(&[u8], &[u8], &[u8])> {
    let mut p = rest.strip_prefix(b"\t")?.splitn(4, |&b| b == b'\t');
    let level = p.next()?;
    p.next()?;
    let module = p.next()?;
    Some((level, module, p.next()?))
}

fn classify(level: &[u8], module: &[u8], tail: &[u8]) -> Line {
    let is = |p: &[u8]| tail.starts_with(p);
    if level != b"INFO" || module != b"VOTA" {
        Line::Other
    } else if WAITING.iter().any(|w| is(w)) {
        Line::Wait
    } else if is(TRY) {
        Line::Try
    } else if is(BIOMETRIC) {
        Line::Bio
    } else if is(VOTE) {
        Line::Done
    } else if is(ENABLED) {
        Line::Enabled
    } else if is(CONFIRM) {
        Line::Confirm
    } else if is(WRONG) {
        Line::Wrong
    } else if is(CORRECT) {
        Line::Correct
    } else if NOISE.iter().any(|n| is(n)) {
        Line::Noise
    } else {
        Line::Other
    }
}

/// A message as `LEVEL|MODULE|text`: the numbers of up to 9 digits become `{}` and are returned, longer ones (ids of people) become `#`.
fn shape(level: &[u8], module: &[u8], msg: &[u8]) -> (String, Vec<u32>) {
    let mut text = format!("{}|{}|", latin1(level), latin1(module));
    let (mut params, mut i) = (Vec::new(), 0);
    while i < msg.len() {
        let run = msg[i..].iter().take_while(|b| b.is_ascii_digit()).count();
        if run == 0 {
            text.push(msg[i] as char);
            i += 1;
        } else if run >= 10 {
            text.push('#');
            i += run;
        } else {
            text.push_str(&if run > 1 && msg[i] == b'0' { format!("{{{run}}}") } else { "{}".into() }); // `{N}`: zero padded to N digits
            params.push(msg[i..i + run].iter().fold(0, |n, &d| n * 10 + (d - b'0') as u32));
            i += run;
        }
    }
    (text, params)
}

fn render(shape: &str, params: &[u32]) -> String {
    let mut params = params.iter();
    HOLE.replace_all(shape, |c: &regex::Captures| format!("{:01$}", params.next().unwrap_or(&0), c[1].parse().unwrap_or(0))).into_owned()
}

/// The voters and the other lines of a log, for the lines of `day`. Voters are told apart exactly as `scan` does.
fn read_section(log: &[u8], day: &[u8], templates: &Mutex<Templates>) -> SectionLog {
    let mut s = SectionLog::default();
    let (mut bio, mut attempts, mut prev_done) = (false, false, 0i64);
    let mut cycle: Vec<Item> = Vec::new();
    let mut loose: Vec<(u32, String, Vec<u32>)> = Vec::new();
    let keep = |loose: &mut Vec<_>, items: &mut Vec<Item>, all: bool| {
        for i in items.drain(..).filter(|i| all || i.line == Line::Other) {
            let (text, params) = shape(i.level, i.module, i.msg);
            loose.push((i.secs, text, params));
        }
    };
    for (date, secs, rest) in log.split(|&b| b == b'\n').filter_map(stamp) {
        let Some((level, module, tail)) = fields(rest) else { continue };
        let line = classify(level, module, tail);
        match line {
            Line::Wait => (attempts, bio) = (false, false),
            Line::Try => attempts = true,
            Line::Bio => bio = true,
            _ => {}
        }
        if date != day {
            s.other_days += 1;
            continue;
        }
        let msg = tail.split(|&b| b == b'\t').next().unwrap_or_default();
        if line == Line::Wait {
            keep(&mut loose, &mut cycle, true); // the cycle before never reached its vote: all its lines count
        }
        if line != Line::Done {
            cycle.push(Item { secs, level, module, msg, line });
            continue;
        }
        let count = |l| cycle.iter().filter(|i| i.line == l).count();
        let enabled = cycle.iter().rfind(|i| i.line == Line::Enabled).map_or(secs, |i| i.secs);
        let method = if bio { 0 } else if attempts { 1 } else { 2 };
        s.voters.push(Voter {
            gap: enabled as i64 - prev_done,
            dur: secs.saturating_sub(enabled),
            flags: method | ((count(Line::Correct) > 0) as u8) << 2 | (count(Line::Try).min(31) as u8) << 3,
            wrong: count(Line::Wrong).min(255) as u8,
        });
        prev_done = secs as i64;
        keep(&mut loose, &mut cycle, false);
    }
    keep(&mut loose, &mut cycle, true);
    loose.sort_by_key(|l| l.0);
    let mut templates = templates.lock().unwrap();
    s.events = loose.into_iter().map(|(secs, text, params)| Event { secs, template: templates.id(text), params }).collect();
    s
}

fn put(out: &mut Vec<u8>, mut n: u64) {
    while n >= 128 {
        out.push((n & 127 | 128) as u8);
        n >>= 7;
    }
    out.push(n as u8);
}

fn zigzag(n: i64) -> u64 {
    ((n << 1) ^ (n >> 63)) as u64
}

/// `remap[template]` = 0 for a literal, else the template's number in the archive's dictionary.
fn encode(s: &SectionLog, remap: &[u64], shapes: &[String]) -> Vec<u8> {
    let mut b = Vec::new();
    for n in [s.voters.len(), s.events.len(), s.other_days as usize] {
        put(&mut b, n as u64);
    }
    s.voters.iter().for_each(|v| put(&mut b, zigzag(v.gap)));
    s.voters.iter().for_each(|v| put(&mut b, v.dur as u64));
    b.extend(s.voters.iter().map(|v| v.flags));
    b.extend(s.voters.iter().map(|v| v.wrong));
    let mut prev = 0;
    for e in &s.events {
        put(&mut b, (e.secs - prev) as u64);
        prev = e.secs;
        match remap[e.template] {
            LITERAL => {
                let text = render(&shapes[e.template], &e.params);
                put(&mut b, LITERAL);
                put(&mut b, text.len() as u64);
                b.extend(text.as_bytes());
            }
            id => {
                put(&mut b, id);
                e.params.iter().for_each(|&p| put(&mut b, p as u64));
            }
        }
    }
    b
}

fn deflate(b: &[u8]) -> Result<Vec<u8>> {
    let mut e = DeflateEncoder::new(Vec::new(), Compression::best());
    e.write_all(b)?;
    Ok(e.finish()?)
}

fn inflate(b: &[u8]) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    DeflateDecoder::new(b).read_to_end(&mut out)?;
    Ok(out)
}

struct Cursor<'a>(&'a [u8]);

impl<'a> Cursor<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8]> {
        ensure!(self.0.len() >= n, "truncated data");
        let (head, tail) = self.0.split_at(n);
        self.0 = tail;
        Ok(head)
    }

    fn varint(&mut self) -> Result<u64> {
        let (mut n, mut shift) = (0u64, 0);
        loop {
            let b = self.take(1)?[0];
            n |= ((b & 127) as u64) << shift;
            if b < 128 {
                return Ok(n);
            }
            shift += 7;
        }
    }

    fn uint(&mut self, bytes: usize) -> Result<u64> {
        Ok(self.take(bytes)?.iter().rev().fold(0, |n, &b| n << 8 | b as u64))
    }
}

/// A blob read back: voters as (enabled at, voted at, flags, wrong keys) in seconds of the day, and the other events as (seconds, text).
#[derive(Debug, PartialEq)]
struct Decoded {
    voters: Vec<(u32, u32, u8, u8)>,
    events: Vec<(u32, String)>,
    other_days: u32,
}

fn decode(blob: &[u8], dictionary: &[String]) -> Result<Decoded> {
    let mut c = Cursor(blob);
    let (voters, events, other_days) = (c.varint()? as usize, c.varint()? as usize, c.varint()? as u32);
    let unzig = |n: u64| (n >> 1) as i64 ^ -((n & 1) as i64);
    let gaps = (0..voters).map(|_| c.varint().map(unzig)).collect::<Result<Vec<_>>>()?;
    let durs = (0..voters).map(|_| c.varint()).collect::<Result<Vec<_>>>()?;
    let (flags, wrong) = (c.take(voters)?, c.take(voters)?);
    let mut done = 0i64;
    let voters = (0..voters)
        .map(|i| {
            let enabled = done + gaps[i];
            done = enabled + durs[i] as i64;
            (enabled as u32, done as u32, flags[i], wrong[i])
        })
        .collect();
    let mut secs = 0;
    let events = (0..events)
        .map(|_| {
            secs += c.varint()? as u32;
            let text = match c.varint()? {
                LITERAL => {
                    let len = c.varint()? as usize;
                    String::from_utf8(c.take(len)?.to_vec())?
                }
                id => {
                    let shape = dictionary.get(id as usize - 1).ok_or_else(|| anyhow!("template {id} is not in the dictionary"))?;
                    let params = (0..HOLE.find_iter(shape).count()).map(|_| c.varint().map(|p| p as u32)).collect::<Result<Vec<_>>>()?;
                    render(shape, &params)
                }
            };
            Ok((secs, text))
        })
        .collect::<Result<_>>()?;
    Ok(Decoded { voters, events, other_days })
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Record {
    city: u32,
    zone: u16,
    section: u16,
    offset: u32,
    len: u32,
}

struct Parsed {
    at: (u16, u16, u32), // zone, section, city: the pack's order
    name: String,
    log: SectionLog,
}

/// The templates met at least `common` times, sorted (so the output does not depend on the order the threads ran), and every template's number in them.
fn dictionary(parsed: &[Parsed], templates: &Templates, common: usize) -> (Vec<String>, Vec<u64>) {
    let mut seen = vec![0; templates.list.len()];
    parsed.iter().flat_map(|p| &p.log.events).for_each(|e| seen[e.template] += 1);
    let mut kept: Vec<usize> = (0..seen.len()).filter(|&t| seen[t] >= common).collect();
    kept.sort_by(|&a, &b| templates.list[a].cmp(&templates.list[b]));
    let mut remap = vec![LITERAL; seen.len()];
    kept.iter().enumerate().for_each(|(n, &t)| remap[t] = n as u64 + 1);
    (kept.iter().map(|&t| templates.list[t].clone()).collect(), remap)
}

/// The pack and the (compressed) index of sections already read.
fn assemble(mut parsed: Vec<Parsed>, templates: Templates, common: usize) -> Result<(Vec<u8>, Vec<u8>)> {
    parsed.sort_by(|a, b| (a.at, &a.name).cmp(&(b.at, &b.name)));
    let (dict, remap) = dictionary(&parsed, &templates, common);
    let blobs = parsed.par_iter().map(|p| deflate(&encode(&p.log, &remap, &templates.list))).collect::<Result<Vec<_>>>()?;
    let mut idx = [MAGIC.as_slice(), &(parsed.len() as u32).to_le_bytes(), &(dict.len() as u32).to_le_bytes()].concat();
    for d in &dict {
        idx.extend((d.len() as u16).to_le_bytes());
        idx.extend(d.as_bytes());
    }
    let mut pack = Vec::new();
    for (p, blob) in parsed.iter().zip(&blobs) {
        let (zone, section, city) = p.at;
        for field in [city.to_le_bytes().as_slice(), &zone.to_le_bytes(), &section.to_le_bytes(), &(pack.len() as u32).to_le_bytes(), &(blob.len() as u32).to_le_bytes()] {
            idx.extend(field);
        }
        pack.extend(blob);
    }
    Ok((pack, deflate(&idx)?))
}

/// The dictionary and the records of an index.
fn read_index(idx: &[u8]) -> Result<(Vec<String>, Vec<Record>)> {
    let raw = inflate(idx)?;
    let mut c = Cursor(&raw);
    ensure!(c.take(4)? == MAGIC, "not a logpack index");
    let (sections, templates) = (c.uint(4)? as usize, c.uint(4)? as usize);
    let dict = (0..templates).map(|_| { let n = c.uint(2)? as usize; Ok(String::from_utf8(c.take(n)?.to_vec())?) }).collect::<Result<Vec<_>>>()?;
    let records = (0..sections).map(|_| Ok(Record { city: c.uint(4)? as u32, zone: c.uint(2)? as u16, section: c.uint(2)? as u16, offset: c.uint(4)? as u32, len: c.uint(4)? as u32 })).collect::<Result<_>>()?;
    Ok((dict, records))
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let tmp = path.with_extension("tmp"); // a partial file is never taken for a result
    File::create(&tmp)?.write_all(bytes)?;
    Ok(fs::rename(tmp, path)?)
}

fn pack_archive(path: &str, day: &[u8], key: &str, out: &Path, common: usize) -> Result<(usize, usize, usize)> {
    let templates = Mutex::new(Templates::default());
    let parsed = map_logs(path, |zip, i, name| {
        let [_, city, zone, section] = place(path, name)?;
        let log = read_section(&entry_log(zip, i, name)?, day, &templates);
        Ok(Parsed { at: (zone.parse()?, section.parse()?, city.parse()?), name: name.to_string(), log })
    })?;
    let n = parsed.len();
    let (pack, idx) = assemble(parsed, templates.into_inner().unwrap(), common)?;
    let c = ARCHIVE.captures(path).ok_or_else(|| anyhow!("{path}: not <name>-<uf>-<nn>.zip"))?;
    let stem = format!("{key}-logpack-{}-{}", &c[1], &c[2]);
    write_atomic(&out.join(format!("{stem}.pack")), &pack)?;
    write_atomic(&out.join(format!("{stem}.idx")), &idx)?; // the index lands last: a listed index always has its pack
    Ok((n, pack.len(), idx.len()))
}

pub fn run(args: &[String]) -> Result<()> {
    let [day, key, out, archives @ ..] = args else { bail!("usage: logscan pack <day dd/mm/yyyy> <election key> <out dir> <logs zip>...") };
    fs::create_dir_all(out)?;
    for path in archives {
        let (n, pack, idx) = pack_archive(path, day.as_bytes(), key, Path::new(out), COMMON)?;
        println!("{path} {n} sections, pack {pack} B, idx {idx} B");
    }
    Ok(())
}

fn clock(s: u32) -> String {
    format!("{:02}:{:02}:{:02}", s / 3600 % 24, s / 60 % 60, s % 60)
}

/// Prints what a pack holds for a section: one line per voter and per other event.
pub fn show(args: &[String]) -> Result<()> {
    let [idx, pack, zone, section] = args else { bail!("usage: logscan show <.idx> <.pack> <zone> <section>") };
    let (dict, records) = read_index(&fs::read(idx).with_context(|| idx.clone())?)?;
    let pack = fs::read(pack).with_context(|| pack.clone())?;
    let (zone, section): (u16, u16) = (zone.parse()?, section.parse()?);
    for r in records.iter().filter(|r| (r.zone, r.section) == (zone, section)) {
        let d = decode(&inflate(&pack[r.offset as usize..(r.offset + r.len) as usize])?, &dict)?;
        println!("city {} zone {zone} section {section}: {} voters, {} events, {} lines of other days", r.city, d.voters.len(), d.events.len(), d.other_days);
        for (enabled, done, flags, wrong) in d.voters {
            println!("{} -> {} method {} tries {} corrected {} wrong keys {wrong}", clock(enabled), clock(done), flags & 3, flags >> 3, flags >> 2 & 1);
        }
        d.events.iter().for_each(|(secs, text)| println!("{} {text}", clock(*secs)));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: &[u8] = b"04/10/2026";
    const WAIT: &[u8] = b"Aguardando digita\xe7\xe3o do identificador do eleitor";
    const TYPED: &[u8] = b"Identificador do eleitor digitado pelo mes\xe1rio";
    const PHOTO: &[u8] = b"Foto do eleitor apresentada";
    const ASK: &[u8] = b"Solicita digital. Tentativa [1] de [4]";
    const TAKEN: &[u8] = b"Capturada a digital. Tentativa [1] de [4]";
    const BIO: &[u8] = b"Tipo de habilita\xe7\xe3o do eleitor [biom\xe9trica]";
    const ENABLED_MSG: &[u8] = b"Eleitor foi habilitado";
    const FEDERAL: &[u8] = b"Voto confirmado para [Deputado Federal]";
    const PRESIDENT: &[u8] = b"Voto confirmado para [Presidente]";
    const WRONG_KEY: &[u8] = b"Tecla indevida pressionada";
    const FIX: &[u8] = b"Eleitor corrigiu na tela de confirma\xe7\xe3o de candidato";
    const DONE: &[u8] = b"O voto do eleitor foi computado";
    const HELPED: &[u8] = b"Mes\xe1rio 020991222232 habilitou o eleitor";

    /// Lines as the urn writes them: `date time<TAB>level<TAB>id<TAB>module<TAB>message<TAB>hash`, the message in latin1.
    fn log(lines: &[(&str, &str, &str, &[u8])]) -> Vec<u8> {
        lines.iter().flat_map(|(when, level, module, msg)| [format!("{when}\t{level}\t02085276\t{module}\t").as_bytes(), msg, b"\t8FB9F2A39A2C7D59\n"].concat()).collect()
    }

    fn vota<'a>(when: &'a str, msg: &'a [u8]) -> (&'a str, &'a str, &'a str, &'a [u8]) {
        (when, "INFO", "VOTA", msg)
    }

    fn read(log: &[u8]) -> (SectionLog, Templates) {
        let templates = Mutex::new(Templates::default());
        (read_section(log, DAY, &templates), templates.into_inner().unwrap())
    }

    fn with_ordinary_cycles() -> Vec<u8> {
        log(&[
            vota("04/10/2026 10:30:53", WAIT), vota("04/10/2026 10:30:53", TYPED), vota("04/10/2026 10:30:53", PHOTO), vota("04/10/2026 10:30:57", ASK),
            vota("04/10/2026 10:31:02", TAKEN), vota("04/10/2026 10:31:06", BIO), vota("04/10/2026 10:31:06", ENABLED_MSG), vota("04/10/2026 10:31:14", FEDERAL),
            vota("04/10/2026 10:31:30", WRONG_KEY), vota("04/10/2026 10:31:35", PRESIDENT), vota("04/10/2026 10:31:36", DONE),
            vota("04/10/2026 10:31:37", WAIT), vota("04/10/2026 10:31:59", HELPED), vota("04/10/2026 10:32:03", ASK), vota("04/10/2026 10:32:10", ENABLED_MSG),
            vota("04/10/2026 10:32:14", FIX), vota("04/10/2026 10:32:20", WRONG_KEY), vota("04/10/2026 10:32:21", WRONG_KEY), vota("04/10/2026 10:33:01", DONE),
        ])
    }

    #[test]
    fn a_voter_keeps_when_how_and_how_long() {
        let (s, _) = read(&with_ordinary_cycles());
        let secs = |h: u32, m: u32, sec: u32| h * 3600 + m * 60 + sec;
        let first = Voter { gap: secs(10, 31, 6) as i64, dur: 30, flags: 0 | 1 << 3, wrong: 1 };
        let second = Voter { gap: (secs(10, 32, 10) - secs(10, 31, 36)) as i64, dur: 51, flags: 1 | 1 << 2 | 1 << 3, wrong: 2 };
        assert_eq!(s.voters, [first, second]);
        assert_eq!(s.events.iter().map(|e| e.secs).collect::<Vec<_>>(), [secs(10, 31, 59)]); // the poll worker enabling is the only line outside the ordinary cycle
    }

    #[test]
    fn tells_voters_apart_as_scan_does() {
        let mut lines = with_ordinary_cycles();
        lines.extend(log(&[vota("04/10/2026 10:40:00", WAIT), vota("04/10/2026 10:40:50", ENABLED_MSG), vota("04/10/2026 10:41:30", DONE), vota("03/10/2026 09:00:00", DONE)]));
        let (s, _) = read(&lines);
        let scanned = crate::scan(&lines, DAY);
        let by = |m| s.voters.iter().filter(|v| v.flags & 3 == m).count() as u32;
        assert_eq!((by(0), by(1), by(2), s.voters.len() as u32), (scanned.bio, scanned.man, scanned.nor, scanned.votes));
        assert_eq!(s.other_days, 1);
    }

    #[test]
    fn keeps_every_line_of_a_cycle_that_never_reached_its_vote() {
        let (s, templates) = read(&log(&[
            vota("04/10/2026 11:00:00", WAIT), vota("04/10/2026 11:00:05", TYPED), vota("04/10/2026 11:00:09", b"Eleitor foi suspenso pelo mes\xe1rio"),
            vota("04/10/2026 11:01:00", WAIT), vota("04/10/2026 11:01:10", ENABLED_MSG), vota("04/10/2026 11:02:00", DONE),
        ]));
        assert_eq!(s.voters.len(), 1);
        let texts: Vec<_> = s.events.iter().map(|e| render(&templates.list[e.template], &e.params)).collect();
        assert_eq!(texts, ["INFO|VOTA|Aguardando digitação do identificador do eleitor", "INFO|VOTA|Identificador do eleitor digitado pelo mesário", "INFO|VOTA|Eleitor foi suspenso pelo mesário"]);
    }

    #[test]
    fn numbers_become_parameters_and_ids_of_people_are_dropped() {
        let (s, templates) = read(&log(&[
            vota("04/10/2026 11:00:00", HELPED),
            ("04/10/2026 08:29:57", "INFO", "LOGD", b"Urna ligada em 22/09/2026 \xe0s 08:29:03"),
            ("04/10/2026 09:00:00", "ALERTA", "VOTA", b"T\xedtulo 123456789012 \xe9 v\xe1lido para suspender a vota\xe7\xe3o"),
        ]));
        let by_time: Vec<_> = s.events.iter().map(|e| (templates.list[e.template].as_str(), e.params.as_slice())).collect();
        assert_eq!(by_time[0], ("INFO|LOGD|Urna ligada em {}/{2}/{} às {2}:{}:{2}", &[22, 9, 2026, 8, 29, 3][..]));
        assert_eq!(by_time[1], ("ALERTA|VOTA|Título # é válido para suspender a votação", &[][..]));
        assert_eq!(by_time[2], ("INFO|VOTA|Mesário # habilitou o eleitor", &[][..]));
    }

    fn parsed(city: u32, zone: u16, section: u16, name: &str, lines: &[u8], templates: &Mutex<Templates>) -> Parsed {
        Parsed { at: (zone, section, city), name: name.into(), log: read_section(lines, DAY, templates) }
    }

    #[test]
    fn the_index_finds_a_section_and_its_range_reads_back_alone() {
        let templates = Mutex::new(Templates::default());
        let ordinary = with_ordinary_cycles();
        let night = log(&[("04/10/2026 08:29:57", "INFO", "LOGD", b"Urna ligada em 22/09/2026 \xe0s 08:29:03"), vota("04/10/2026 11:00:00", HELPED)]);
        let all = vec![
            parsed(70998, 127, 680, "b", &ordinary, &templates), parsed(70998, 127, 12, "a", &night, &templates), parsed(71072, 9, 1, "c", &night, &templates),
            parsed(70998, 127, 680, "a", &night, &templates), // a second urn of the same section
        ];
        let (pack, idx) = assemble(all, templates.into_inner().unwrap(), 2).unwrap();
        let (dict, records) = read_index(&idx).unwrap();
        let order: Vec<_> = records.iter().map(|r| (r.zone, r.section, r.city)).collect();
        assert_eq!(order, [(9, 1, 71072), (127, 12, 70998), (127, 680, 70998), (127, 680, 70998)]);
        assert_eq!(records.iter().map(|r| r.len as usize).sum::<usize>(), pack.len());
        let read = |r: &Record| decode(&inflate(&pack[r.offset as usize..(r.offset + r.len) as usize]).unwrap(), &dict).unwrap();
        assert_eq!(read(&records[3]).voters.len(), 2); // urn "b" sorts after urn "a"
        assert_eq!(read(&records[2]).voters.len(), 0);
        assert_eq!(read(&records[2]).events.iter().map(|e| e.1.as_str()).collect::<Vec<_>>(), ["INFO|LOGD|Urna ligada em 22/09/2026 às 08:29:03", "INFO|VOTA|Mesário # habilitou o eleitor"]);
        assert_eq!(dict, ["INFO|LOGD|Urna ligada em {}/{2}/{} às {2}:{}:{2}", "INFO|VOTA|Mesário # habilitou o eleitor"].map(String::from)); // met 3 times; the rest stays literal
    }

    #[test]
    fn rare_shapes_stay_literal_and_read_back_the_same() {
        let templates = Mutex::new(Templates::default());
        let serial = log(&[("04/10/2026 08:00:00", "INFO", "GAP", b"Serial da MV: 4BC7AF")]);
        let all = vec![parsed(1, 1, 1, "a", &serial, &templates)];
        let (pack, idx) = assemble(all, templates.into_inner().unwrap(), COMMON).unwrap();
        let (dict, records) = read_index(&idx).unwrap();
        assert!(dict.is_empty());
        let blob = inflate(&pack[..records[0].len as usize]).unwrap();
        assert_eq!(decode(&blob, &dict).unwrap().events, [(28800, "INFO|GAP|Serial da MV: 4BC7AF".to_string())]);
    }

    #[test]
    fn a_blob_of_a_section_without_voting_is_tiny() {
        let (s, _) = read(b"not a log\n\n03/10/2026 08:00:00\tINFO\t1\tGAP\tUrna ligada\thash\n");
        assert_eq!((s.voters.len(), s.events.len(), s.other_days), (0, 0, 1));
        assert!(encode(&s, &[], &[]).len() <= 3);
    }
}
