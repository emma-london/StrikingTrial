import { useState } from 'react'
import RecordScreen from './components/RecordScreen'
import SessionList from './components/SessionList'

export default function App() {
  const [refreshKey, setRefreshKey] = useState(0)

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-brand">Striking Trial</h1>
        <p className="app-tagline">Record and analyse tower bell striking</p>
      </header>
      <main className="app-main">
        <RecordScreen onFinished={() => setRefreshKey((n) => n + 1)} />
        <SessionList refreshKey={refreshKey} />
      </main>
    </div>
  )
}
