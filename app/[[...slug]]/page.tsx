'use client'

import dynamic from 'next/dynamic'

// The member area is a client-side application. Keeping it out of the server
// bundle also prevents Recharts/Lodash vendor chunks from being required by
// the Next.js server during development.
const App = dynamic(() => import('../../src/App'), { ssr: false })

export default function Page() {
  return <App />
}
