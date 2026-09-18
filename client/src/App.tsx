import { HealthBadge } from './components/HealthBadge';
import { Chat } from './components/Chat';
import './styles.css';

export default function App() {
  return (
    <div className="app">
      <header>
        <h1>Copilot Agent</h1>
        <p className="sub">React (Vite) → Express API → @github/copilot-sdk</p>
        <HealthBadge />
      </header>
      <main>
        <Chat />
      </main>
    </div>
  );
}
