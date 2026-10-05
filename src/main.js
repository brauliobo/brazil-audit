import { createVaporApp } from 'vue'
import App from './App.vue'
import { manifestReady } from './data'
import './style.css'

await manifestReady
createVaporApp(App).mount('#app')
