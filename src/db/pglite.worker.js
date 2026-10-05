// PGlite runs in this worker (PGliteWorker proxies the main thread's calls), so heavy queries never block the UI.
import { PGlite } from '@electric-sql/pglite'
import { worker } from '@electric-sql/pglite/worker'

worker({ init: ({ dataDir }) => PGlite.create({ dataDir, relaxedDurability: true }) })
