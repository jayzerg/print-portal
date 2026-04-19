// Configuration
const API_BASE_URL = '/api';

// Utilities
const showStatus = (elementId, message, isError = false) => {
    const el = document.getElementById(elementId);
    el.textContent = message;
    el.className = isError ? 'status-error' : 'status-success';
    el.classList.remove('hidden');
};

const hideStatus = (elementId) => {
    const el = document.getElementById(elementId);
    el.classList.add('hidden');
    el.className = '';
};

// Main Form Logic
const uploadForm = document.getElementById('uploadForm');
if (uploadForm) {
    uploadForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const submitBtn = document.getElementById('submit-btn');
        const fileInput = document.getElementById('file_upload');
        const file = fileInput.files[0];
        
        if (!file) return;

        // Custom client-side size validation (50MB)
        if (file.size > 50 * 1024 * 1024) {
            showStatus('status-message', 'File exceeds maximum allowed size (50MB).', true);
            return;
        }

        submitBtn.disabled = true;
        hideStatus('status-message');
        
        try {
            // STEP 1: Get Presigned URL
            showStatus('status-message', 'Configuring secure upload...', false);
            
            const presignedRes = await fetch(`${API_BASE_URL}/upload/presigned`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: file.name })
            });
            
            if (!presignedRes.ok) {
                const error = await presignedRes.json();
                throw new Error(error.detail || 'Failed to get upload authorization');
            }
            
            const presignedData = await presignedRes.json();
            const { url, method, content_type } = presignedData;
            const fileKey = presignedData.filename; // Fixed to parse correctly from main.py return

            // STEP 2: Upload direct to R2 using XMLHttpRequest PUT
            showStatus('status-message', 'Uploading file securely...', false);
            const progressContainer = document.getElementById('progress-container');
            const progressFill = document.getElementById('progress-fill');
            const progressText = document.getElementById('progress-text');
            progressContainer.classList.remove('hidden');

            await new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.open(method || 'PUT', url, true);
                
                if (content_type) {
                    xhr.setRequestHeader('Content-Type', content_type);
                }
                
                xhr.upload.onprogress = (e) => {
                    if (e.lengthComputable) {
                        const percent = Math.round((e.loaded / e.total) * 100);
                        progressFill.style.width = `${percent}%`;
                        progressText.textContent = `Uploading: ${percent}%`;
                    }
                };
                
                xhr.onload = () => {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        resolve();
                    } else {
                        reject(new Error(`Upload failed with status ${xhr.status}. Cloudflare rejected the file.`));
                    }
                };
                
                xhr.onerror = (err) => {
                    console.error("Upload Network Error:", err, "URL attempted:", url);
                    reject(new Error(`CORS or Network error! Cloudflare blocked the request. Check your Bucket Settings -> CORS policy!`));
                };
                xhr.send(file);
            });

            progressContainer.classList.add('hidden');

            // STEP 3: Create Order Record
            showStatus('status-message', 'Finalizing order...', false);
            
            const orderData = {
                client_name: document.getElementById('client_name').value,
                contact_email: document.getElementById('contact_email').value,
                contact_phone: document.getElementById('contact_phone').value || null,
                copies: parseInt(document.getElementById('copies').value),
                color_mode: document.querySelector('input[name="color_mode"]:checked').value,
                paper_size: document.getElementById('paper_size').value,
                file_key: fileKey,
                file_name: file.name
            };

            const headers = { 'Content-Type': 'application/json' };
            const token = localStorage.getItem('client_token');
            if (token) headers['Authorization'] = `Bearer ${token}`;

            const orderRes = await fetch(`${API_BASE_URL}/orders`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(orderData)
            });

            if (!orderRes.ok) throw new Error('Order creation failed on our server.');

            showStatus('status-message', 'Order placed successfully! You will be contacted shortly.');
            uploadForm.reset();
            
        } catch (error) {
            showStatus('status-message', error.message, true);
            const progressContainer = document.getElementById('progress-container');
            if (progressContainer) progressContainer.classList.add('hidden');
        } finally {
            submitBtn.disabled = false;
        }
    });
}

// Admin Dashboard Logic
window.initAdminDashboard = async () => {
    const tbody = document.getElementById('orders-tbody');
    const refreshBtn = document.getElementById('refresh-btn');
    
    const fetchOrders = async () => {
        try {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center">Loading orders...</td></tr>';
            
            const response = await fetch(`${API_BASE_URL}/admin/orders`);
            
            if (response.status === 401) {
                // If the browser natively didn't pop up auth or failed
                tbody.innerHTML = '<tr><td colspan="6" class="text-center status-error">Unauthorized. Please reload and login.</td></tr>';
                return;
            }
            if (!response.ok) throw new Error('Failed to fetch orders');
            
            const orders = await response.json();
            renderOrders(orders);
        } catch (error) {
            tbody.innerHTML = `<tr><td colspan="6" class="text-center status-error">${error.message}</td></tr>`;
        }
    };

    const renderOrders = (orders) => {
        if (orders.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center">No orders found.</td></tr>';
            return;
        }

        tbody.innerHTML = '';
        orders.forEach(o => {
            const tr = document.createElement('tr');
            
            tr.innerHTML = `
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
            `;
            tbody.appendChild(tr);
        });
    };

    window.downloadFile = async (id) => {
        try {
            const res = await fetch(`${API_BASE_URL}/admin/orders/${id}/download`);
            if (!res.ok) throw new Error('Failed to get download URL');
            const data = await res.json();
            window.open(data.url, '_blank');
        } catch (error) {
            alert(error.message);
        }
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
            fetchOrders();
        } catch (error) {
            alert(error.message);
        }
    };

    if (refreshBtn) refreshBtn.addEventListener('click', fetchOrders);
    
    // Initial fetch
    fetchOrders();
};
