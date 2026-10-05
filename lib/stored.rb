# Marks in the cache which files already had their votes stored in the database (one mark per database),
# so a resume only stores what is missing
module Stored
  DIR = "#{DATA_DIR}/stored/#{DB_NAME}"

  FileUtils.mkdir_p DIR

  def self.done? *id
    File.exist? path(id)
  end

  def self.mark *id
    FileUtils.touch path(id)
  end

  def self.path id
    "#{DIR}/#{id.join '-'}"
  end
end
