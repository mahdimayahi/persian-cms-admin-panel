'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * مسیریاب سبک مبتنی بر hash — پشتیبانی از دکمه بازگشت مرورگر
 * مسیرها مانند: #/articles/xyz/edit و #/articles/new?template=abc
 */
export function useHashRoute() {
  const parse = () => {
    if (typeof window === 'undefined') return { path: '/dashboard', query: new URLSearchParams() }
    const raw = window.location.hash.replace(/^#/, '') || '/dashboard'
    const qIndex = raw.indexOf('?')
    const path = qIndex >= 0 ? raw.slice(0, qIndex) : raw
    const query = new URLSearchParams(qIndex >= 0 ? raw.slice(qIndex + 1) : '')
    return { path, query }
  }

  const [state, setState] = useState(parse)

  useEffect(() => {
    const onChange = () => setState(parse())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  const navigate = useCallback((to: string) => {
    if (window.location.hash === `#${to}`) {
      const qIndex = to.indexOf('?')
      setState({
        path: qIndex >= 0 ? to.slice(0, qIndex) : to,
        query: new URLSearchParams(qIndex >= 0 ? to.slice(qIndex + 1) : ''),
      })
      return
    }
    window.location.hash = to
  }, [])

  const segments = state.path.split('/').filter(Boolean)
  return { path: state.path, query: state.query, segments, navigate }
}

export function navigate(to: string) {
  window.location.hash = to
}
