/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

// Contours des pays (TopoJSON), importes a la demande par lib/worldCountries
declare module 'world-atlas/countries-50m.json' {
  const topology: unknown
  export default topology
}
