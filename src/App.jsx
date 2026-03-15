// App.jsx — Main app shell: sidebar + content area router.

import React from 'react'
import useStore from './store/useStore'
import Sidebar from './components/Sidebar'
import NewStoryModal from './components/NewStoryModal'
import StoryEditor from './pages/StoryEditor'
import ExportPage from './pages/ExportPage'
import Settings from './pages/Settings'

export default function App() {
  const { currentPage, isNewStoryModalOpen } = useStore()

  function renderPage() {
    switch (currentPage) {
      case 'export':   return <ExportPage />
      case 'settings': return <Settings />
      case 'editor':
      default:         return <StoryEditor />
    }
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-cream font-sans">
      <Sidebar />

      <main className="flex-1 flex flex-col min-w-0 min-h-0">
        {renderPage()}
      </main>

      {isNewStoryModalOpen && <NewStoryModal />}
    </div>
  )
}
