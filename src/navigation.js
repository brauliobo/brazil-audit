// Primary navigation follows questions; established analytical URLs remain unchanged.
export const NAV_AREAS = [
  { id: 'summary', view: 'overview', views: ['overview'] },
  { id: 'explore', view: 'maps', views: ['maps', 'drill', 'analysis', 'parliament', 'seats', 'history'] },
  { id: 'compare', view: 'compare', views: ['compare'] },
  { id: 'investigate', view: 'time', views: ['time', 'signals', 'benford', 'logs'] },
]
export const areaForView = (view) => NAV_AREAS.find((area) => area.views.includes(view)) ?? null
