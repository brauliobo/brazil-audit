import { createVaporApp } from 'vue'
import App from './App.vue'
import { manifestReady } from './data'
import { initLocale } from './i18n'
import { startRouter } from './router'
import './theme'
import './design/index.css'

await Promise.all([manifestReady, initLocale()])
startRouter()
createVaporApp(App).mount('#app')
