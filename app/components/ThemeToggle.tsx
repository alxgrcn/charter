'use client'

import { useEffect, useState } from 'react'

export default function ThemeToggle() {
  const [isDark, setIsDark] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem('charter-theme')
    if (stored === 'dark') {
      setIsDark(true)
      document.documentElement.classList.add('dark')
    }
  }, [])

  function toggle() {
    const next = !isDark
    setIsDark(next)
    if (next) {
      document.documentElement.classList.add('dark')
      localStorage.setItem('charter-theme', 'dark')
    } else {
      document.documentElement.classList.remove('dark')
      localStorage.setItem('charter-theme', 'light')
    }
  }

  return (
    <button
      onClick={toggle}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        zIndex: 50,
        width: 80,
        height: 40,
        borderRadius: 20,
        background: isDark ? '#1e2a3a' : '#87CEEB',
        transition: 'background 0.4s ease',
        border: 'none',
        cursor: 'pointer',
        padding: 0,
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {/* Stars — visible in dark mode on left side */}
      <span style={{
        position: 'absolute',
        width: 4, height: 4,
        borderRadius: '50%',
        background: 'white',
        top: 9, left: 12,
        opacity: isDark ? 0.9 : 0,
        transition: 'opacity 0.4s ease',
      }} />
      <span style={{
        position: 'absolute',
        width: 3, height: 3,
        borderRadius: '50%',
        background: 'white',
        top: 22, left: 20,
        opacity: isDark ? 0.6 : 0,
        transition: 'opacity 0.4s ease',
      }} />
      <span style={{
        position: 'absolute',
        width: 2, height: 2,
        borderRadius: '50%',
        background: 'white',
        top: 11, left: 28,
        opacity: isDark ? 0.5 : 0,
        transition: 'opacity 0.4s ease',
      }} />

      {/* Sliding circle */}
      <span style={{
        position: 'absolute',
        width: 32,
        height: 32,
        borderRadius: '50%',
        background: isDark ? '#c8cdd4' : '#FFD700',
        top: 4,
        left: isDark ? 44 : 4,
        transition: 'left 0.4s ease, background 0.4s ease, box-shadow 0.4s ease',
        boxShadow: isDark ? 'none' : '0 0 10px rgba(255, 215, 0, 0.7)',
        overflow: 'hidden',
      }}>
        {/* Moon crescent cutout — an offset dark circle layered on top */}
        <span style={{
          position: 'absolute',
          width: 26,
          height: 26,
          borderRadius: '50%',
          background: '#1e2a3a',
          top: -4,
          left: 10,
          opacity: isDark ? 1 : 0,
          transition: 'opacity 0.4s ease',
        }} />
      </span>
    </button>
  )
}
