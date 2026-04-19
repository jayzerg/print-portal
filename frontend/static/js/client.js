const API_BASE = '/api';
let currentMode = 'login';

// Check if already logged in
window.onload = () => {
    const token = localStorage.getItem('client_token');
    if (token) {
        showDashboard();
    }
};

window.switchAuth = (mode) => {
    currentMode = mode;
    const tabs = document.querySelectorAll('.tab');
    tabs[0].classList.toggle('active', mode === 'login');
    tabs[1].classList.toggle('active', mode === 'register');
    document.getElementById('auth-btn').textContent = mode === 'login' ? 'Login' : 'Register';
    document.getElementById('auth-status').classList.add('hidden');
};

document.getElementById('auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const statusEl = document.getElementById('auth-status');
    
    try {
        if (currentMode === 'register') {
            const res = await fetch(`${API_BASE}/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            if (!res.ok) throw new Error((await res.json()).detail);
            statusEl.textContent = "Registered successfully! Please login.";
            statusEl.className = "status-message status-success";
            switchAuth('login');
        } else {
            // OAuth2 requires form encoding for login
            const formData = new URLSearchParams();
            formData.append('username', username);
            formData.append('password', password);
            
            const res = await fetch(`${API_BASE}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: formData
            });
            if (!res.ok) throw new Error("Invalid credentials");
            
            const data = await res.json();
            localStorage.setItem('client_token', data.access_token);
            showDashboard();
        }
    } catch (err) {
        statusEl.textContent = err.message;
        statusEl.className = "status-message status-error";
        statusEl.classList.remove('hidden');
    }
});

window.logout = () => {
    localStorage.removeItem('client_token');
    document.getElementById('auth-view').style.display = 'block';
    document.getElementById('dashboard-view').style.display = 'none';
};

async function showDashboard() {
    document.getElementById('auth-view').style.display = 'none';
    document.getElementById('dashboard-view').style.display = 'block';
    
    const token = localStorage.getItem('client_token');
    const tbody = document.getElementById('client-orders-tbody');
    
    try {
        const res = await fetch(`${API_BASE}/client/orders`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (res.status === 401) {
            logout();
            return;
        }
        
        const orders = await res.json();
        
        if (orders.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center">No orders yet.</td></tr>';
            return;
        }
        
        tbody.innerHTML = orders.map(o => `
            <tr>
                <td><small>${o.id.substring(0, 8)}</small></td>
                <td>${o.file_name}</td>
                <td>${o.copies}x ${o.paper_size} (${o.color_mode})</td>
                <td>${new Date(o.created_at).toLocaleDateString()}</td>
                <td><span class="badge badge-${o.status}">${o.status}</span></td>
            </tr>
        `).join('');
    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="5" class="status-error">Failed to load orders</td></tr>';
    }
}
