# Marks in the cache which files already had their votes stored in the database (one mark per database),
# so a resume only stores what is missing
module Stored
  DIR = "#{DATA_DIR}/stored/#{DB_NAME}"

  FileUtils.mkdir_p DIR

  # a mark is state-city-zone-section-hash; a section with one stored hash is done, none has more than one hash
  SECTIONS = Dir.children(DIR).to_set{ |mark| mark.split('-').first(4).join('-') }

  def self.done? *id
    File.exist? path(id)
  end

  def self.section? *key
    SECTIONS.include? key.join('-')
  end

  def self.mark *id
    FileUtils.touch path(id)
    SECTIONS << id.first(4).join('-')
  end

  def self.path id
    "#{DIR}/#{id.join '-'}"
  end
end
