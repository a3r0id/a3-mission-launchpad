type Props = {
  onGoMission: () => void
  onGoSettings: () => void
}

export function HomePage({ onGoMission, onGoSettings }: Props) {
  return (
    <div className="page-stack">

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
          Step 2: Create a new Mission
        </h2>
        <p className="card-body">
          Open the mission builder, fill in the basics, and seamlessly bootstrap your next project.
        </p>
        <button type="button" className="btn btn-primary" onClick={onGoMission}>
          New Mission
        </button>
      </section>   

      <section className="card" aria-labelledby="next-heading">
        <h2 id="next-heading" className="card-title">
          Step 3: Join the Discord Community to chat, get support and more!
        </h2>
        <iframe
          src="https://discord.com/widget?id=1495804381638168739&theme=dark"
          width={'100%'}
          height={'500px'}
          style={{ border: 'none', borderRadius: '8px' }}
          allowTransparency
          sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
          title="Discord community"
        />
      </section>         
    </div>
  )
}
