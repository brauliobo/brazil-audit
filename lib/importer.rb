# Imports every CSV of the zips that have a target, WORKERS at a time. Each file is one transaction (staging, insert and
# the row of `imports` with its counts): a resume reads only the files not finished and a failed one leaves nothing behind.
module Importer
  # the zips of the other files (eleitorado, coligações, partido, ...) are kept raw, nothing is imported from them
  TARGETS = {
    /^votacao_secao_/              => Targets::Votes,
    /^detalhe_votacao_secao_/      => Targets::SectionDetail,
    /^consulta_cand_#{YEAR}\.zip/   => Targets::Candidates,
    /^votacao_candidato_munzona/   => Targets::Elected,
    /^bweb_/i                      => Targets::SectionUrn,
    /^CEFT_/                       => Targets::UrnMatch
  }

  UNITS = ENV['STATES']&.upcase&.split || Sources::UFS + %w[BR ZZ]

  def self.run
    done = DB[:imports].select_map(:name).to_set
    jobs.reject{ |zip, entry, *| done.include? name(zip, entry) }.peach{ |zip, entry, _size, target| import zip, entry, target }
  end

  def self.import zip, entry, target
    DB.transaction do
      stg, lines = Staging.load zip, entry
      rows, votes, unclassified, skipped = DB["SELECT count(*) AS rows, #{target::TOTALS} FROM #{stg}"].first.values
      raise "#{name zip, entry}: #{rows} rows for #{lines - 1} lines" unless rows == lines - 1

      loaded = DB.execute_dui target.insert(stg, entry)
      DB[:imports].insert name: name(zip, entry), rows:, loaded:, votes:, unclassified:, skipped:, at: Time.now
      DB.run "DROP TABLE #{stg}"
      puts "#{name zip, entry} rows=#{rows} loaded=#{loaded} votes=#{votes} unclassified=#{unclassified} skipped=#{skipped}"
    end
  end

  def self.name(zip, entry) = "#{File.basename zip}/#{entry}"

  # [zip, csv, bytes, target], the biggest first so no worker is left with a big file at the end
  def self.jobs
    TARGETS.flat_map do |pattern, target|
      zips(pattern).flat_map{ |zip| entries(zip).map{ |entry, size| [zip, entry, size, target] } }
    end.sort_by{ |job| -job[2] }
  end

  def self.zips(pattern) = Dir["#{RAW_DIR}/*.zip"].select{ |zip| pattern.match? File.basename(zip) }

  # [name, bytes] of the CSVs of a state, BR (the president) or ZZ (the foreign vote); the *_BRASIL.csv of the zips is
  # every one of them again
  def self.entries zip
    IO.popen(['unzip', '-Zl', zip], &:readlines).map(&:split).map{ |f| [f.last, f[3].to_i] }
      .select{ |name, _| UNITS.include? name[/_([A-Z]{2})(?:_\d+)?\.csv$/, 1] }
  end
end
