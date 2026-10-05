require_relative 'lib/boot'

Fetch.run if PHASES.include? 'fetch'

if PHASES.include? 'import'
  Schema.setup
  Importer.run
end
