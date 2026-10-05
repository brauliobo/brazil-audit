require 'active_support/all'
require 'fileutils'

%w[config peach sources download manifest fetch db schema sql].each{ |f| require_relative f }
Dir[File.join __dir__, 'targets/*.rb'].each{ |f| require f }
%w[staging importer remote_zip rdvlog_pack rdvlog_fetch rdv voting_log].each{ |f| require_relative f }
Dir[File.join __dir__, 'machine/*.rb'].sort.each{ |f| require f }
