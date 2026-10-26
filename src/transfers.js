// Build-time availability comes from the published artifact index, never from catalog promises.
const indexes = import.meta.glob('../data/transfers/index.json',{eager:true,import:'default'})
export const transferIndex = Object.values(indexes)[0]
