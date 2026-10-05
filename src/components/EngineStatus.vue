<script setup vapor>
import { engine } from '../db'
import { store, clearLocal } from '../data'
import { pct } from '../format'
</script>

<template lang="pug">
.status(:class="{ err: engine.error || store.error }")
  template(v-if="engine.error || store.error") ✖ {{ engine.error || store.error }}
  template(v-else-if="!engine.ready")
    span {{ engine.text }}
    progress
  template(v-else)
    span PGlite (PostgreSQL em WASM, num worker) · {{ engine.queries }} consultas
    span.load(v-for="(p, key) in store.progress" :key="key") importando {{ key }} {{ pct(p, 0) }}
    button.ghost.persist(title="Apaga as tabelas importadas no IndexedDB e o cache dos arquivos de dados" @click="clearLocal") limpar dados locais
</template>
