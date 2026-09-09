export default function LoadState({ loading, error, retry }) {
  if (error) return <div role="alert" className="card mb-4"><p>No se pudo cargar esta información.</p><button type="button" className="btn btn-secondary" onClick={retry}>Reintentar carga</button></div>
  if (!loading) return null
  return <div role="status" aria-label="Cargando información" className="card mb-4"><p>Cargando información…</p><div className="loading-line" /><div className="loading-line" /></div>
}
