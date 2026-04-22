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
        setInterval(fetchOrders, 5000);
    }
    
    // Auto-init admin if it exists
    if (document.getElementById('orders-tbody')) {
        initAdminDashboard();
    }
};

window.fetchOrders = async () => {
    const tbody = document.getElementById('client-orders-tbody');
    if (!tbody) return;
    
    let url = `${API_BASE_URL}/client/orders`;
    try {
        const myOrderIds = JSON.parse(localStorage.getItem('myOrderIds') || '[]');
        if (myOrderIds.length > 0) {
            const params = new URLSearchParams();
            myOrderIds.forEach(id => params.append('order_ids', id));
            url += `?${params.toString()}`;
        }
    } catch(e) {}

    try {
        const res = await fetch(url);
        
        if (!res.ok) throw new Error('Failed to fetch');
        
        const orders = await res.json();
        if (orders.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center">No orders yet. Start printing!</td></tr>';
            return;
        }
        
        const renderFileName = (nameStr) => {
            try {
                const names = JSON.parse(nameStr);
                if (Array.isArray(names)) return names.join('<br>');
            } catch(e) {}
            return nameStr;
        };
        
        tbody.innerHTML = orders.map(o => `
            <tr>
                <td>${o.client_name}</td>
                <td>
                    ${renderFileName(o.file_name)}<br>
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
    const hideSuccessMessage = () => {
        const msg = document.getElementById('status-message');
        if (msg && msg.classList.contains('status-success')) {
            hideStatus('status-message');
        }
    };
    
    uploadForm.addEventListener('input', hideSuccessMessage);
    uploadForm.addEventListener('change', hideSuccessMessage);
    uploadForm.addEventListener('click', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'LABEL') {
            hideSuccessMessage();
        }
    });

    uploadForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const submitBtn = document.getElementById('submit-btn');
        const fileInput = document.getElementById('file_upload');
        const files = Array.from(fileInput.files);
        
        if (files.length === 0) return;
        if (files.length > 5) {
            showStatus('status-message', 'Maximum 5 files allowed per order.', true);
            return;
        }

        for (const file of files) {
            if (file.size > 50 * 1024 * 1024) {
                showStatus('status-message', `File "${file.name}" exceeds maximum allowed size (50MB).`, true);
                return;
            }
        }

        submitBtn.disabled = true;
        hideStatus('status-message');
        
        try {
            showStatus('status-message', 'Configuring upload...', false);
            
            const progressContainer = document.getElementById('progress-container');
            const progressFill = document.getElementById('progress-fill');
            const progressText = document.getElementById('progress-text');
            progressContainer.classList.remove('hidden');
            
            let uploadedFilesCount = 0;
            const fileKeys = [];
            const fileNames = [];

            // We upload files sequentially to ensure the progress bar makes sense and avoid rate limit / bandwidth issues
            for (const file of files) {
                const presignedRes = await fetch(`${API_BASE_URL}/upload/presigned`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filename: file.name })
                });
                
                if (!presignedRes.ok) throw new Error(`Failed to get upload authorization for ${file.name}`);
                const presignedData = await presignedRes.json();
                const { url, method, content_type, filename: fileKey } = presignedData;
    
                showStatus('status-message', `Uploading ${file.name}...`, false);
    
                await new Promise((resolve, reject) => {
                    const xhr = new XMLHttpRequest();
                    xhr.open(method || 'PUT', url, true);
                    if (content_type) xhr.setRequestHeader('Content-Type', content_type);
                    xhr.upload.onprogress = (evt) => {
                        if (evt.lengthComputable) {
                            const filePercent = (evt.loaded / evt.total);
                            const overallPercent = Math.round(((uploadedFilesCount + filePercent) / files.length) * 100);
                            progressFill.style.width = `${overallPercent}%`;
                            progressText.textContent = `Uploading: ${overallPercent}% (${uploadedFilesCount + 1}/${files.length})`;
                        }
                    };
                    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed for ${file.name}`));
                    xhr.onerror = () => reject(new Error('Network error.'));
                    xhr.send(file);
                });
                
                fileKeys.push(fileKey);
                fileNames.push(file.name);
                uploadedFilesCount++;
            }

            progressContainer.classList.add('hidden');
            showStatus('status-message', 'Finalizing order...', false);
            
            const orderData = {
                client_name: document.getElementById('client_name').value,
                contact_email: "no-email@provided.com",
                contact_phone: null,
                copies: parseInt(document.getElementById('copies').value),
                color_mode: document.querySelector('input[name="color_mode"]:checked').value,
                paper_size: document.getElementById('paper_size').value,
                file_key: JSON.stringify(fileKeys),
                file_name: JSON.stringify(fileNames)
            };

            const orderRes = await fetch(`${API_BASE_URL}/orders`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(orderData)
            });

            if (!orderRes.ok) throw new Error('Order creation failed.');
            const createdOrder = await orderRes.json();
            
            try {
                const myOrderIds = JSON.parse(localStorage.getItem('myOrderIds') || '[]');
                if (!myOrderIds.includes(createdOrder.id)) {
                    myOrderIds.push(createdOrder.id);
                    localStorage.setItem('myOrderIds', JSON.stringify(myOrderIds));
                }
            } catch(e) {}

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
    
    const fetchAdminOrders = async (isPolling = false) => {
        try {
            if (!isPolling) tbody.innerHTML = '<tr><td colspan="6" class="text-center">Loading orders...</td></tr>';
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

            const renderFileName = (nameStr) => {
                try {
                    const names = JSON.parse(nameStr);
                    if (Array.isArray(names)) return names.join('<br>');
                } catch(e) {}
                return nameStr;
            };
    
            const renderDownloadButtons = (id, nameStr) => {
                try {
                    const names = JSON.parse(nameStr);
                    if (Array.isArray(names) && names.length > 1) {
                        return names.map((n, i) => `<button class="btn btn-secondary btn-sm" onclick="downloadSingleFile('${id}', ${i})" style="margin-right: 4px; margin-bottom: 4px;">DL ${i+1}</button>`).join('');
                    }
                } catch(e) {}
                return `<button class="btn btn-secondary" onclick="downloadSingleFile('${id}', 0)">Download</button>`;
            };

            tbody.innerHTML = orders.map(o => `
                <tr>
                    <td><strong>${o.client_name}</strong></td>
                    <td>
                        <small>${o.contact_email}</small><br>
                        <small>${o.contact_phone || ''}</small>
                    </td>
                    <td>
                        ${o.copies}x ${o.paper_size}<br>
                        <small style="text-transform:uppercase">${o.color_mode}</small>
                    </td>
                    <td>${renderFileName(o.file_name)}</td>
                    <td><span class="badge badge-${o.status}">${o.status}</span></td>
                    <td class="action-links">
                        ${renderDownloadButtons(o.id, o.file_name)}
                        ${o.status === 'pending' ? `<button class="btn btn-primary" onclick="updateStatus('${o.id}', 'printed')">Mark Printed</button>` : ''}
                        ${o.status === 'printed' ? `<button class="btn btn-secondary" style="background:#64748b" onclick="updateStatus('${o.id}', 'archived')">Archive</button>` : ''}
                    </td>
                </tr>
            `).join('');
        } catch (error) {
            tbody.innerHTML = `<tr><td colspan="6" class="status-error">${error.message}</td></tr>`;
        }
    };

    window.downloadSingleFile = async (id, idx) => {
        try {
            const res = await fetch(`${API_BASE_URL}/admin/orders/${id}/download`);
            if (!res.ok) throw new Error('Failed to get download URL');
            const data = await res.json();
            if (data.urls && data.urls.length > idx) {
                window.location.href = data.urls[idx];
            } else if (data.url) {
                window.location.href = data.url;
            }
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

    fetchAdminOrders();
    setInterval(() => fetchAdminOrders(true), 15000);
};
