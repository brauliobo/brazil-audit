require_relative 'lib/boot'

Fetch.run if PHASES.include? 'fetch'
RdvlogFetch.run if PHASES.include? 'rdvlog'

Schema.setup if (PHASES & %w[import machine]).any?
Importer.run if PHASES.include? 'import'
Machine::Import.run if PHASES.include? 'machine'
