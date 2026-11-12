'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * مسیریاب سبک مبتنی بر hash — پشتیبانی از دکمه بازگشت مرورگر
 * مسیرها مانند: #/articles/xyz/edit
 */
export function useHashRoute() {
  const [path, setPath] = useState<string>(() => (typeof window !== 'undefined' ? window.location.hash.replace(/^#/, '') || '/dashboard' : '/dashboard'))

  useEffect(() => {
    const onChange = () => {
      setPath(window.location.hash.replace(/^#/, '') || '/dashboard')
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  const navigate = useCallback((to: string) => {
    if (window.location.hash === `#${to}`) {
      setPath(to)
      return
    }
    window.location.hash = to
  }, [])

  const segments = path.split('/').filter(Boolean)
  return { path, segments, navigate }
}

export function navigate(to: string) {
  window.location.hash = to
}
