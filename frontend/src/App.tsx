import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import SetupPage from './pages/SetupPage'
import ProgressPage from './pages/ProgressPage'
import ResultsPage from './pages/ResultsPage'
import ChartPage from './pages/ChartPage'
import HistoryPage from './pages/HistoryPage'
import BottomNav from './components/layout/BottomNav'

function AppInner() {
  const location = useLocation()
  const showNav = location.pathname === '/' ||
    location.pathname === '/history' ||
    location.pathname.startsWith('/results/')

  return (
    <div style={{ position: 'relative', minHeight: '100vh' }}>
      <Routes>
        <Route path="/" element={<SetupPage />} />
        <Route path="/progress/:simId" element={<ProgressPage />} />
        <Route path="/results/:simId" element={<ResultsPage />} />
        <Route path="/results/:simId/chart/:strategyId" element={<ChartPage />} />
        <Route path="/history" element={<HistoryPage />} />
      </Routes>
      {showNav && <BottomNav />}
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppInner />
    </BrowserRouter>
  )
}
