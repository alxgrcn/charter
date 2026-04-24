'use client'

import { useEffect, useState } from 'react'

type Props = {
  bottom?: number
}

export default function ThemeToggle({ bottom = 24 }: Props) {
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
        bottom: bottom,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        width: 44,
        height: 22,
        borderRadius: 11,
        background: isDark ? '#1e2a3a' : '#87CEEB',
        transition: 'background 0.4s ease',
        border: 'none',
        cursor: 'pointer',
        padding: 0,
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {/* Sliding circle */}
      <span style={{
        position: 'absolute',
        width: 16,
        height: 16,
        borderRadius: '50%',
        background: isDark ? '#c8cdd4' : '#FFD700',
        top: 3,
        left: isDark ? 25 : 3,
        transition: 'left 0.4s ease, background 0.4s ease, box-shadow 0.4s ease',
        boxShadow: isDark ? 'none' : '0 0 4px rgba(255, 215, 0, 0.8)',
        overflow: 'hidden',
      }}>
        {/* Moon crescent cutout */}
        <span style={{
          position: 'absolute',
          width: 9,
          height: 9,
          borderRadius: '50%',
          background: '#1e2a3a',
          top: -2,
          left: 4,
          opacity: isDark ? 1 : 0,
          transition: 'opacity 0.4s ease',
        }} />
      </span>
    </button>
  )
}
