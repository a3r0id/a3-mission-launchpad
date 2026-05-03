type Props = {
  onGoMission: () => void
  onGoSettings: () => void
}

export function HomePage({ onGoMission, onGoSettings }: Props) {
  return (
    <div className="mission-page relative z-[1] flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-surface">
      <div className="scrollbar-subtle min-h-0 flex-1 overflow-y-auto">
        <div className="page-stack px-5 py-4">
          <section className="card" aria-labelledby="home-step-settings">
            <h2 id="home-step-settings" className="card-title">
              Step 1: Set your settings
            </h2>
            <p className="card-body">
              Set your installation paths to integrate with the application with Arma 3 and the Arma 3 Tools. You can
              always change these settings later.
            </p>
            <button type="button" className="btn btn-primary" onClick={onGoSettings}>
              Open Settings
            </button>
          </section>

          <section className="card" aria-labelledby="home-step-mission">
            <h2 id="home-step-mission" className="card-title">
              Step 2: Create a new Mission
            </h2>
            <p className="card-body">
              Open the mission builder, fill in the basics, and seamlessly bootstrap your next project.
            </p>
            <button type="button" className="btn btn-primary" onClick={onGoMission}>
              New Mission
            </button>
          </section>

          <section className="card" aria-labelledby="home-step-discord">
            <h2 id="home-step-discord" className="card-title">
              Step 3: Join the Discord Community to chat, get support and more!
            </h2>
            <iframe
              src="https://discord.com/widget?id=1495804381638168739&theme=dark"
              className="mt-1 h-[min(50vh,560px)] w-full rounded-lg border-0"
              allowTransparency
              sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
              title="Discord community"
            />
          </section>
        </div>
      </div>
    </div>
  )
}
