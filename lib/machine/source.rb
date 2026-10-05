module Machine
  # The RDV and log files of the sections, in units of a round, a state and a zone:
  #   { [turn, uf, zone] => { [city_code, section] => { rdvs: [ref], logs: [ref] } } }, a ref being [zip, entry] or [file]
  # A section can have two logs: the .logjez and a .logsajez (a second urn, as the BU has a .busa); and, in the files of the
  # portal, two RDVs (two hashes, one of them of the .logsajez).
  # The first round is in the zips of RDVLOG_DIR (entries o00406-<city><zone><section>.<ext>), the second in the files of the
  # portal collector (<uf>-<city>-<zone>-<section>-<hash>-o00407-<city><zone><section>.<ext>).
  module Source
    EXT    = /(rdv|log\w*)/            # .logjez, and .logsajez of the sections with a separate count

    def self.units
      (zips + legacy).each_with_object(Hash.new{ |h, k| h[k] = {} }) do |(turn, uf, city, zone, section, kind, ref), units|
        files = units[[turn, uf, zone]][[city, section]] ||= { rdvs: [], logs: [] }
        files[kind == 'rdv' ? :rdvs : :logs] << ref
      end
    end

    def self.zips
      Dir["#{RDVLOG_DIR}/#{YEAR}-1t-rdv-logs-*.zip"].sort.flat_map do |path|
        uf = path[/rdv-logs-(\w\w)-/, 1].upcase
        Zip::File.open(path){ |zip| zip.entries.map(&:name) }.map do |name|
          code, city, zone, section, kind = name.match(/\A(o\d+)-(\d{5})(\d{4})(\d{4})\.#{EXT}\z/).captures
          [MACHINE[:rounds].fetch(code), uf, city, zone, section, kind, [path, name]]
        end
      end
    end

    def self.legacy
      (Dir.children(MACHINE[:legacy]) - %w[.gitkeep]).map do |name|
        uf, city, zone, section, code, kind = name.match(/\A(\w\w)-(\d{5})-(\d{4})-(\d{4})-\h+-(o\d+)-\d+\.#{EXT}\z/).captures
        [MACHINE[:rounds].fetch(code), uf.upcase, city, zone, section, kind, ["#{MACHINE[:legacy]}/#{name}"]]
      end
    end

    def self.read(ref) = ref.size == 1 ? File.binread(ref.first) : zip(ref.first).read(ref.last)

    # the zips opened by this process: a worker goes through a few at a time
    def self.zip path
      @zips ||= {}
      @zips.shift if @zips.size >= 4 && !@zips.key?(path)
      @zips[path] ||= Zip::File.open path
    end
  end
end
