<script setup vapor>
import { href } from '../router'
import { DEFAULT_ELECTION } from '../model'
import { t } from '../i18n'
</script>

<template lang="pug">
h1 {{ t('errors.notFoundTitle') }}
p.muted {{ t('errors.notFound') }}
p
  a(:href="href(DEFAULT_ELECTION, 'overview')") {{ t('errors.backHome') }}
</template>
