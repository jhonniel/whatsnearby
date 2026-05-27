import { AlertTriangle, Gauge } from 'lucide-react'

export function MapTrafficPanel({
  trafficFlowOn,
  trafficIncidentsOn,
  onTrafficFlowChange,
  onTrafficIncidentsChange,
}) {
  return (
    <div className="map-traffic-panel" aria-label="TomTom traffic layers">
      <p className="map-traffic-panel-heading">Traffic</p>
      <button
        type="button"
        className={`map-traffic-panel-btn${trafficFlowOn ? ' is-active' : ''}`}
        aria-pressed={trafficFlowOn}
        title="Road speeds: green = free flow, red = slow"
        onClick={() => onTrafficFlowChange(!trafficFlowOn)}
      >
        <Gauge size={16} strokeWidth={2.1} aria-hidden="true" />
        <span>Flow</span>
      </button>
      <button
        type="button"
        className={`map-traffic-panel-btn${trafficIncidentsOn ? ' is-active' : ''}`}
        aria-pressed={trafficIncidentsOn}
        title="Accidents, jams, closures"
        onClick={() => onTrafficIncidentsChange(!trafficIncidentsOn)}
      >
        <AlertTriangle size={16} strokeWidth={2.1} aria-hidden="true" />
        <span>Incidents</span>
      </button>
      {trafficFlowOn ? (
        <p className="map-traffic-legend" aria-hidden="true">
          <span className="map-traffic-legend-swatch map-traffic-legend-swatch--free" /> Free
          <span className="map-traffic-legend-swatch map-traffic-legend-swatch--slow" /> Slow
          <span className="map-traffic-legend-swatch map-traffic-legend-swatch--heavy" /> Heavy
        </p>
      ) : null}
    </div>
  )
}
