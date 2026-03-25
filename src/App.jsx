import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { ToastProvider } from './lib/toast'
import Layout from './components/Layout'
import Board from './pages/Board'
import LeadDetail from './pages/LeadDetail'
import FollowUps from './pages/FollowUps'
import Analytics from './pages/Analytics'

export default function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Board />} />
            <Route path="leads/:id" element={<LeadDetail />} />
            <Route path="followups" element={<FollowUps />} />
            <Route path="analytics" element={<Analytics />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  )
}
