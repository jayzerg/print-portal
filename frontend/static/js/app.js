// Configuration
const API_BASE_URL = '/api';

// Utilities
const showStatus = (elementId, message, isError = false) => {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.textContent = message;
    el.className = isError ? 'status-message status-error' : 'status-message status-success';
    el.classList.remove('hidden');
};

const hideStatus = (elementId) => {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.classList.add('hidden');
    el.className = 'status-message';
};

// =======================
// CLIENT DASHBOARD LOGIC
// =======================

window.onload = () => {
    if (document.getElementById('client-orders-tbody')) {
        fetchOrders();
    }
    
    // Auto-init admin if it exists
    if (document.getElementById('orders-tbody')) {
        initAdminDashboard();
    }
};

window.fetchOrders = async () => {
    const tbody = document.getElementById('client-orders-tbody');
    if (!tbody) return;
    
    try {
        const res = await fetch(`${API_BASE_URL}/client/orders`);
        
        if (!res.ok) throw new Error('Failed to fetch');
        
        const orders = await res.json();
        if (orders.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center">No orders yet. Start printing!</td></tr>';
            return;
        }
        
        tbody.innerHTML = orders.map(o => `
            <tr>
                <td><small>${o.id.substring(0, 8)}</small></td>
                <td>
                    ${o.file_name}<br>
                    <small>${o.copies}x ${o.paper_size} (${o.color_mode})</small>
                </td>
                <td>${new Date(o.created_at).toLocaleDateString()}</td>
                <td><span class="badge badge-${o.status}">${o.status}</span></td>
            </tr>
        `).join('');
    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="4" class="status-error text-center">Failed to load orders</td></tr>';
    }
};

// =======================
// CLIENT ORDER UPLOAD LOGIC
// =======================
const uploadForm = document.getElementById('uploadForm');
if (uploadForm) {
    uploadForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const submitBtn = document.getElementById('submit-btn');
        const fileInput = document.getElementById('file_upload');
        const file = fileInput.files[0];
        if (!file) return;

        if (file.size > 50 * 1024 * 1024) {
            showStatus('status-message', 'File exceeds maximum allowed size (50MB).', true);
            return;
        }

        submitBtn.disabled = true;
        hideStatus('status-message');
        
        try {
            showStatus('status-message', 'Configuring upload...', false);
            
            const presignedRes = await fetch(`${API_BASE_URL}/upload/presigned`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: file.name })
            });
            
            if (!presignedRes.ok) throw new Error('Failed to get upload authorization');
            const presignedData = await presignedRes.json();
            const { url, method, content_type, filename: fileKey } = presignedData;

            showStatus('status-message', 'Uploading file securely...', false);
            const progressContainer = document.getElementById('progress-container');
            const progressFill = document.getElementById('progress-fill');
            const progressText = document.getElementById('progress-text');
            progressContainer.classList.remove('hidden');

            await new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.open(method || 'PUT', url, true);
                if (content_type) xhr.setRequestHeader('Content-Type', content_type);
                xhr.upload.onprogress = (evt) => {
                    if (evt.lengthComputable) {
                        const percent = Math.round((evt.loaded / evt.total) * 100);
                        progressFill.style.width = `${percent}%`;
                        progressText.textContent = `Uploading: ${percent}%`;
                    }
                };
                xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('Upload failed.'));
                xhr.onerror = () => reject(new Error('Network error.'));
                xhr.send(file);
            });

            progressContainer.classList.add('hidden');
            showStatus('status-message', 'Finalizing order...', false);
            
            const orderData = {
                client_name: document.getElementById('client_name').value,
                contact_email: "no-email@provided.com",
                contact_phone: null,
                copies: parseInt(document.getElementById('copies').value),
                color_mode: document.querySelector('input[name="color_mode"]:checked').value,
                paper_size: document.getElementById('paper_size').value,
                file_key: fileKey,
                file_name: file.name
            };

            const orderRes = await fetch(`${API_BASE_URL}/orders`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(orderData)
            });

            if (!orderRes.ok) throw new Error('Order creation failed.');

            showStatus('status-message', '🎉 Order placed successfully!');
            uploadForm.reset();
            window.fetchOrders(); // Refresh table
            
        } catch (error) {
            showStatus('status-message', error.message, true);
            document.getElementById('progress-container').classList.add('hidden');
        } finally {
            submitBtn.disabled = false;
        }
    });
}

// =======================
// ADMIN LOGIC
// =======================
window.initAdminDashboard = async () => {
    const tbody = document.getElementById('orders-tbody');
    const refreshBtn = document.getElementById('refresh-btn');
    
    const fetchAdminOrders = async () => {
        try {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center">Loading orders...</td></tr>';
            const response = await fetch(`${API_BASE_URL}/admin/orders`);
            if (response.status === 401) {
                tbody.innerHTML = '<tr><td colspan="6" class="status-error">Unauthorized.</td></tr>';
                return;
            }
            if (!response.ok) throw new Error('Failed to fetch orders');
            
            const orders = await response.json();
            if (orders.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" class="text-center">No orders found.</td></tr>';
                return;
            }

            tbody.innerHTML = orders.map(o => `
                <tr>
                    <td><small>${o.id.substring(0, 8)}...</small></td>
                    <td>
                        <strong>${o.client_name}</strong><br>
                        <small>${o.contact_email}</small><br>
                        <small>${o.contact_phone || ''}</small>
                    </td>
                    <td>
                        ${o.copies}x ${o.paper_size}<br>
                        <small style="text-transform:uppercase">${o.color_mode}</small>
                    </td>
                    <td>${o.file_name}</td>
                    <td><span class="badge badge-${o.status}">${o.status}</span></td>
                    <td class="action-links">
                        <button class="btn btn-secondary" onclick="downloadFile('${o.id}')">Download</button>
                        ${o.status === 'pending' ? `<button class="btn btn-primary" onclick="updateStatus('${o.id}', 'printed')">Mark Printed</button>` : ''}
                        ${o.status === 'printed' ? `<button class="btn btn-secondary" style="background:#64748b" onclick="updateStatus('${o.id}', 'archived')">Archive</button>` : ''}
                    </td>
                </tr>
            `).join('');
        } catch (error) {
            tbody.innerHTML = `<tr><td colspan="6" class="status-error">${error.message}</td></tr>`;
        }
    };

    window.downloadFile = async (id) => {
        try {
            const res = await fetch(`${API_BASE_URL}/admin/orders/${id}/download`);
            if (!res.ok) throw new Error('Failed to get download URL');
            const data = await res.json();
            window.open(data.url, '_blank');
        } catch (error) { alert(error.message); }
    };

    window.updateStatus = async (id, status) => {
        if (!confirm(`Mark this order as ${status}?`)) return;
        try {
            const res = await fetch(`${API_BASE_URL}/admin/orders/${id}/status`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status })
            });
            if (!res.ok) throw new Error('Failed to update status');
            fetchAdminOrders();
        } catch (error) { alert(error.message); }
    };

    if (refreshBtn) refreshBtn.addEventListener('click', fetchAdminOrders);
    fetchAdminOrders();
};
