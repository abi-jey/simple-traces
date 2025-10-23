import './App.css'

function NotFound() {
  return (
    <div className="empty-state" style={{ marginTop: '4rem' }}>
      <h2>404 - Page Not Found</h2>
      <p>The page you're looking for doesn't exist.</p>
      <button
        onClick={() => window.location.href = '/'}
        style={{
          marginTop: '1rem',
          padding: '0.5rem 1rem',
          background: 'var(--primary)',
          color: 'white',
          border: 'none',
          borderRadius: '8px',
          cursor: 'pointer',
          fontSize: '0.875rem',
          transition: 'all 0.2s ease',
        }}
        onMouseOver={(e) => e.target.style.transform = 'translateY(-1px)'}
        onMouseOut={(e) => e.target.style.transform = 'translateY(0)'}
      >
        Go Home
      </button>
    </div>
  )
}

export default NotFound
