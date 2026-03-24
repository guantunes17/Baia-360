import { useState } from 'react'
import axios from 'axios'
import './App.css'

const API = 'http://localhost:5000'

function Login({ onLogin }) {
  const [email, setEmail]   = useState('')
  const [senha, setSenha]   = useState('')
  const [erro,  setErro]    = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setErro('')
    setLoading(true)
    try {
      const res = await axios.post(`${API}/api/auth/login`, { email, senha })
      localStorage.setItem('token',   res.data.token)
      localStorage.setItem('usuario', JSON.stringify(res.data.usuario))
      onLogin(res.data.usuario)
    } catch (err) {
      setErro(err.response?.data?.erro || 'Erro ao conectar ao servidor')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-container">
      <div className="login-box">
        <h1>Baia 360</h1>
        <p className="login-sub">Plataforma de Relatórios</p>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="seu@email.com"
              required
            />
          </div>
          <div className="field">
            <label>Senha</label>
            <input
              type="password"
              value={senha}
              onChange={e => setSenha(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>
          {erro && <p className="erro">{erro}</p>}
          <button type="submit" disabled={loading}>
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}

function Dashboard({ usuario, onLogout }) {
  return (
    <div className="dashboard">
      <header>
        <h2>Baia 360</h2>
        <div className="user-info">
          <span>Olá, {usuario.nome}</span>
          <button onClick={onLogout}>Sair</button>
        </div>
      </header>
      <main>
        <h3>Dashboard</h3>
        <p>Em construção — módulos serão adicionados aqui.</p>
      </main>
    </div>
  )
}

function App() {
  const [usuario, setUsuario] = useState(() => {
    const u = localStorage.getItem('usuario')
    return u ? JSON.parse(u) : null
  })

  const handleLogin  = (u) => setUsuario(u)
  const handleLogout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('usuario')
    setUsuario(null)
  }

  return usuario
    ? <Dashboard usuario={usuario} onLogout={handleLogout} />
    : <Login onLogin={handleLogin} />
}

export default App