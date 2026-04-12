import { useEffect, useState } from 'react'
import { checkBackendReachable } from '../api/launchpad'

type Props = {
  onGoMission: () => void
  onGoSettings: () => void
}

export function HomePage({ onGoMission, onGoSettings }: Props) {
  const [online, setOnline] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    void checkBackendReachable().then((ok) => {
      if (!cancelled) setOnline(ok)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="page-stack">


      <section className="card" aria-labelledby="status-heading">
        <h2 id="status-heading" className="card-title">
          Backend
        </h2>
        <div className="status-row">
          <span
            className={`status-dot${online === true ? ' is-on' : online === false ? ' is-off' : ''}`}
            aria-hidden="true"
          />
          <div>
            <div className="status-label">
              {online === null && 'Checking connection…'}
              {online === true && 'Connected'}
              {online === false && 'Not reachable'}
            </div>
            <p className="status-detail">
              {online === false &&
                'Start the launchpad server from the repo root, then refresh this page.'}
              {online === true &&
                'The backend seems healthy. Everything is ready to go!'}
            </p>
          </div>
        </div>
      </section>

      <section className="card" aria-labelledby="next-heading">
        <h2 id="next-heading" className="card-title">
          Step 1: Set your settings
        </h2>
        <p className="card-body">
          Set your installation paths to integrate with the application with Arma 3 and the Arma 3 Tools. You can always change these settings later.
        </p>
        <button type="button" className="btn btn-primary" onClick={onGoSettings}>
          Open Settings
        </button>
      </section>

      <section className="card" aria-labelledby="next-heading">
        <h2 id="next-heading" className="card-title">
          Step 2: Create a new mission
        </h2>
        <p className="card-body">
          Open the mission builder, fill in the basics, and seamlessly bootstrap your next project.
        </p>
        <button type="button" className="btn btn-primary" onClick={onGoMission}>
          New mission
        </button>
      </section>      
    </div>
  )
}
