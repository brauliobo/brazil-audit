// The last render error, shown by App.vue instead of an empty card (cleared on the next navigation).
import { shallowRef } from 'vue'

export const renderError = shallowRef(null)
