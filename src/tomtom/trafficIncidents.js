import { trafficIncidentDetails } from '@tomtom-org/maps-sdk/services'

/** [west, south, east, north] for the Traffic Incident Details API. */
export function bboxFromMapLibre(map) {
  const bounds = map.getBounds()
  return [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()]
}

/** Present-time incidents in the visible map area (GeoJSON FeatureCollection). */
export function fetchTrafficIncidentsForBbox(bbox) {
  return trafficIncidentDetails({
    bbox,
    timeValidityFilter: ['present'],
  })
}

/** Feature count from a Traffic Incident Details response. */
export function incidentFeatureCount(result) {
  if (!result) return 0
  if (Array.isArray(result.features)) return result.features.length
  return 0
}
