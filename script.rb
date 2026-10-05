require_relative 'lib/boot'

Fetch.run if PHASES.include? 'fetch'
RdvlogFetch.run if PHASES.include? 'rdvlog'

if PHASES.include? 'import'
  Schema.setup
  Importer.run
end

Machine::Import.run if PHASES.include? 'machine'
