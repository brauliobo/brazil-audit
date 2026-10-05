import { createVaporApp } from 'vue'
import App from './App.vue'
import { manifestReady } from './data'
import { renderError } from './errors'
import { initLocale } from './i18n'
import { startRouter } from './router'
import './theme'
import './design/index.css'

await Promise.all([manifestReady, initLocale()])
startRouter()
const app = createVaporApp(App)
app.config.errorHandler = (error) => { console.error(error); renderError.value = error }
app.mount('#app')
