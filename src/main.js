import { createVaporApp } from 'vue'
import App from './App.vue'
import { manifestReady } from './data'
import { startRouter } from './router'
import './design/index.css'

await manifestReady
startRouter()
createVaporApp(App).mount('#app')
