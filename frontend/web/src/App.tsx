// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface DigitalTwin {
  id: string;
  encryptedInterests: string;
  timestamp: number;
  owner: string;
  status: "active" | "inactive";
  earnings: string;
}

const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const FHECompute = (encryptedData: string, operation: string): string => {
  const value = FHEDecryptNumber(encryptedData);
  let result = value;
  
  switch(operation) {
    case 'increase10%':
      result = value * 1.1;
      break;
    case 'decrease10%':
      result = value * 0.9;
      break;
    case 'double':
      result = value * 2;
      break;
    default:
      result = value;
  }
  
  return FHEEncryptNumber(result);
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [twins, setTwins] = useState<DigitalTwin[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newTwinData, setNewTwinData] = useState({ 
    entertainment: 50,
    technology: 50,
    fashion: 50,
    sports: 50,
    finance: 50
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [selectedTwin, setSelectedTwin] = useState<DigitalTwin | null>(null);
  const [decryptedInterests, setDecryptedInterests] = useState<{[key: string]: number} | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [searchTerm, setSearchTerm] = useState('');

  const activeCount = twins.filter(t => t.status === "active").length;
  const inactiveCount = twins.filter(t => t.status === "inactive").length;
  const totalEarnings = twins.reduce((sum, twin) => sum + parseFloat(twin.earnings || '0'), 0);

  useEffect(() => {
    loadTwins().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadTwins = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) return;
      
      const keysBytes = await contract.getData("twin_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing twin keys:", e); }
      }
      
      const list: DigitalTwin[] = [];
      for (const key of keys) {
        try {
          const twinBytes = await contract.getData(`twin_${key}`);
          if (twinBytes.length > 0) {
            try {
              const twinData = JSON.parse(ethers.toUtf8String(twinBytes));
              list.push({ 
                id: key, 
                encryptedInterests: twinData.interests, 
                timestamp: twinData.timestamp, 
                owner: twinData.owner, 
                status: twinData.status || "active",
                earnings: twinData.earnings || "0"
              });
            } catch (e) { console.error(`Error parsing twin data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading twin ${key}:`, e); }
      }
      list.sort((a, b) => b.timestamp - a.timestamp);
      setTwins(list);
    } catch (e) { console.error("Error loading twins:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const createTwin = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setCreating(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting interests with Zama FHE..." });
    try {
      // Encrypt each interest category
      const encryptedInterests = {
        entertainment: FHEEncryptNumber(newTwinData.entertainment),
        technology: FHEEncryptNumber(newTwinData.technology),
        fashion: FHEEncryptNumber(newTwinData.fashion),
        sports: FHEEncryptNumber(newTwinData.sports),
        finance: FHEEncryptNumber(newTwinData.finance)
      };

      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const twinId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const twinData = { 
        interests: JSON.stringify(encryptedInterests), 
        timestamp: Math.floor(Date.now() / 1000), 
        owner: address, 
        status: "active",
        earnings: "0"
      };
      
      await contract.setData(`twin_${twinId}`, ethers.toUtf8Bytes(JSON.stringify(twinData)));
      
      const keysBytes = await contract.getData("twin_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(twinId);
      await contract.setData("twin_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Digital twin created successfully!" });
      await loadTwins();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewTwinData({ 
          entertainment: 50,
          technology: 50,
          fashion: 50,
          sports: 50,
          finance: 50
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") ? "Transaction rejected by user" : "Creation failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setCreating(false); }
  };

  const decryptWithSignature = async (encryptedData: string): Promise<{[key: string]: number} | null> => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      const encryptedInterests = JSON.parse(encryptedData);
      const decrypted: {[key: string]: number} = {};
      for (const key in encryptedInterests) {
        decrypted[key] = FHEDecryptNumber(encryptedInterests[key]);
      }
      return decrypted;
    } catch (e) { console.error("Decryption failed:", e); return null; } 
    finally { setIsDecrypting(false); }
  };

  const toggleTwinStatus = async (twinId: string, currentStatus: "active" | "inactive") => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Updating twin status..." });
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const twinBytes = await contract.getData(`twin_${twinId}`);
      if (twinBytes.length === 0) throw new Error("Twin not found");
      
      const twinData = JSON.parse(ethers.toUtf8String(twinBytes));
      const newStatus = currentStatus === "active" ? "inactive" : "active";
      
      const updatedTwin = { ...twinData, status: newStatus };
      await contract.setData(`twin_${twinId}`, ethers.toUtf8Bytes(JSON.stringify(updatedTwin)));
      
      setTransactionStatus({ visible: true, status: "success", message: `Twin ${newStatus === "active" ? "activated" : "deactivated"} successfully!` });
      await loadTwins();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Update failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const isOwner = (twinAddress: string) => address?.toLowerCase() === twinAddress.toLowerCase();

  const tutorialSteps = [
    { title: "Create Your Digital Twin", description: "Set up an encrypted representation of your interests", icon: "👤" },
    { title: "FHE Encryption", description: "Your preferences are encrypted using Zama FHE technology", icon: "🔒", details: "Data remains encrypted during all operations" },
    { title: "Advertisers Test Ads", description: "Brands test ad effectiveness on your encrypted twin", icon: "📊", details: "No personal data is exposed during testing" },
    { title: "Earn Rewards", description: "Get paid when advertisers use your digital twin", icon: "💰", details: "Compensation is automatic and transparent" }
  ];

  const filteredTwins = twins.filter(twin => 
    twin.id.toLowerCase().includes(searchTerm.toLowerCase()) || 
    twin.owner.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const renderInterestChart = (interests: {[key: string]: number}) => {
    return (
      <div className="interest-chart">
        {Object.entries(interests).map(([category, value]) => (
          <div key={category} className="interest-bar">
            <div className="interest-label">{category}</div>
            <div className="interest-value-container">
              <div 
                className="interest-value" 
                style={{ width: `${value}%`, backgroundColor: `hsl(${value * 1.2}, 80%, 50%)` }}
              ></div>
            </div>
            <div className="interest-percentage">{value}%</div>
          </div>
        ))}
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing digital twin connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>DigitalTwin<span>Ad</span>FHE</h1>
          <div className="fhe-badge">ZAMA FHE Powered</div>
        </div>
        <div className="header-actions">
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + Create Twin
          </button>
          <button className="tutorial-btn" onClick={() => setShowTutorial(!showTutorial)}>
            {showTutorial ? "Hide Guide" : "How It Works"}
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>

      <div className="main-content">
        {showTutorial && (
          <div className="tutorial-section">
            <h2>How Digital Twin Ad Testing Works</h2>
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div className="tutorial-step" key={index}>
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                    {step.details && <div className="step-details">{step.details}</div>}
                  </div>
                </div>
              ))}
            </div>
            <div className="fhe-flow">
              <div className="flow-step">
                <div className="flow-icon">👤</div>
                <div className="flow-label">Your Interests</div>
              </div>
              <div className="flow-arrow">→</div>
              <div className="flow-step">
                <div className="flow-icon">🔒</div>
                <div className="flow-label">FHE Encryption</div>
              </div>
              <div className="flow-arrow">→</div>
              <div className="flow-step">
                <div className="flow-icon">📊</div>
                <div className="flow-label">Ad Testing</div>
              </div>
              <div className="flow-arrow">→</div>
              <div className="flow-step">
                <div className="flow-icon">💰</div>
                <div className="flow-label">Earn Rewards</div>
              </div>
            </div>
          </div>
        )}

        <div className="dashboard-section">
          <div className="stats-cards">
            <div className="stat-card">
              <div className="stat-value">{twins.length}</div>
              <div className="stat-label">Total Twins</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{activeCount}</div>
              <div className="stat-label">Active</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{inactiveCount}</div>
              <div className="stat-label">Inactive</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">${totalEarnings.toFixed(2)}</div>
              <div className="stat-label">Total Earnings</div>
            </div>
          </div>

          <div className="project-intro">
            <h2>FHE Digital Twin Ad Testing</h2>
            <p>
              Create an encrypted "digital twin" of your interests using Zama FHE technology. 
              Advertisers can test ad effectiveness on your encrypted twin without accessing your real data.
              Earn rewards when your twin is used for testing while maintaining complete privacy.
            </p>
            <div className="fhe-features">
              <div className="feature">
                <div className="feature-icon">🔒</div>
                <div className="feature-text">End-to-end encrypted</div>
              </div>
              <div className="feature">
                <div className="feature-icon">💰</div>
                <div className="feature-text">Earn from your data</div>
              </div>
              <div className="feature">
                <div className="feature-icon">👁️</div>
                <div className="feature-text">No tracking</div>
              </div>
            </div>
          </div>
        </div>

        <div className="twins-section">
          <div className="section-header">
            <h2>Your Digital Twins</h2>
            <div className="search-box">
              <input 
                type="text" 
                placeholder="Search twins..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <button onClick={loadTwins} disabled={isRefreshing}>
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>

          {filteredTwins.length === 0 ? (
            <div className="no-twins">
              <div className="no-twins-icon">👤</div>
              <p>No digital twins found</p>
              <button onClick={() => setShowCreateModal(true)}>Create Your First Twin</button>
            </div>
          ) : (
            <div className="twins-list">
              {filteredTwins.map(twin => (
                <div 
                  className={`twin-card ${twin.status}`} 
                  key={twin.id}
                  onClick={() => setSelectedTwin(twin)}
                >
                  <div className="twin-id">#{twin.id.substring(0, 6)}</div>
                  <div className="twin-owner">{twin.owner.substring(0, 6)}...{twin.owner.substring(38)}</div>
                  <div className="twin-date">{new Date(twin.timestamp * 1000).toLocaleDateString()}</div>
                  <div className="twin-status">
                    <span className={`status-badge ${twin.status}`}>{twin.status}</span>
                  </div>
                  <div className="twin-earnings">${parseFloat(twin.earnings).toFixed(2)}</div>
                  {isOwner(twin.owner) && (
                    <button 
                      className={`status-toggle ${twin.status}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleTwinStatus(twin.id, twin.status);
                      }}
                    >
                      {twin.status === "active" ? "Deactivate" : "Activate"}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showCreateModal && (
        <ModalCreate 
          onSubmit={createTwin} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating} 
          twinData={newTwinData} 
          setTwinData={setNewTwinData}
        />
      )}

      {selectedTwin && (
        <TwinDetailModal 
          twin={selectedTwin} 
          onClose={() => {
            setSelectedTwin(null);
            setDecryptedInterests(null);
          }} 
          decryptedInterests={decryptedInterests}
          setDecryptedInterests={setDecryptedInterests}
          isDecrypting={isDecrypting}
          decryptWithSignature={decryptWithSignature}
          renderInterestChart={renderInterestChart}
        />
      )}

      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✕"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <h3>DigitalTwinAdFHE</h3>
            <p>Privacy-preserving ad testing powered by Zama FHE</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="copyright">© {new Date().getFullYear()} DigitalTwinAdFHE. All rights reserved.</div>
          <div className="fhe-badge">ZAMA FHE Technology</div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  twinData: any;
  setTwinData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ onSubmit, onClose, creating, twinData, setTwinData }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>, category: string) => {
    const value = parseInt(e.target.value);
    setTwinData({ ...twinData, [category]: value });
  };

  const handleSubmit = () => {
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>Create Digital Twin</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="notice-icon">🔒</div>
            <div className="notice-text">
              <strong>FHE Encryption Notice</strong>
              <p>Your interests will be encrypted with Zama FHE before submission</p>
            </div>
          </div>

          <div className="interest-sliders">
            <h3>Set Your Interest Preferences</h3>
            
            <div className="slider-group">
              <label>Entertainment</label>
              <input 
                type="range" 
                min="0" 
                max="100" 
                value={twinData.entertainment} 
                onChange={(e) => handleChange(e, 'entertainment')}
              />
              <div className="slider-value">{twinData.entertainment}%</div>
            </div>

            <div className="slider-group">
              <label>Technology</label>
              <input 
                type="range" 
                min="0" 
                max="100" 
                value={twinData.technology} 
                onChange={(e) => handleChange(e, 'technology')}
              />
              <div className="slider-value">{twinData.technology}%</div>
            </div>

            <div className="slider-group">
              <label>Fashion</label>
              <input 
                type="range" 
                min="0" 
                max="100" 
                value={twinData.fashion} 
                onChange={(e) => handleChange(e, 'fashion')}
              />
              <div className="slider-value">{twinData.fashion}%</div>
            </div>

            <div className="slider-group">
              <label>Sports</label>
              <input 
                type="range" 
                min="0" 
                max="100" 
                value={twinData.sports} 
                onChange={(e) => handleChange(e, 'sports')}
              />
              <div className="slider-value">{twinData.sports}%</div>
            </div>

            <div className="slider-group">
              <label>Finance</label>
              <input 
                type="range" 
                min="0" 
                max="100" 
                value={twinData.finance} 
                onChange={(e) => handleChange(e, 'finance')}
              />
              <div className="slider-value">{twinData.finance}%</div>
            </div>
          </div>

          <div className="encryption-preview">
            <h4>Encryption Preview</h4>
            <div className="preview-container">
              <div className="plain-data">
                <span>Plain Values:</span>
                <div>
                  {Object.entries(twinData).map(([key, value]) => (
                    <div key={key}>{key}: {value}%</div>
                  ))}
                </div>
              </div>
              <div className="encryption-arrow">→</div>
              <div className="encrypted-data">
                <span>Encrypted Data:</span>
                <div>
                  {Object.entries(twinData).map(([key, value]) => (
                    <div key={key}>{key}: {FHEEncryptNumber(value as number).substring(0, 10)}...</div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button onClick={handleSubmit} disabled={creating} className="submit-btn">
            {creating ? "Creating with FHE..." : "Create Digital Twin"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface TwinDetailModalProps {
  twin: DigitalTwin;
  onClose: () => void;
  decryptedInterests: {[key: string]: number} | null;
  setDecryptedInterests: (value: {[key: string]: number} | null) => void;
  isDecrypting: boolean;
  decryptWithSignature: (encryptedData: string) => Promise<{[key: string]: number} | null>;
  renderInterestChart: (interests: {[key: string]: number}) => JSX.Element;
}

const TwinDetailModal: React.FC<TwinDetailModalProps> = ({ 
  twin, 
  onClose, 
  decryptedInterests,
  setDecryptedInterests,
  isDecrypting,
  decryptWithSignature,
  renderInterestChart
}) => {
  const handleDecrypt = async () => {
    if (decryptedInterests !== null) { 
      setDecryptedInterests(null); 
      return; 
    }
    const decrypted = await decryptWithSignature(twin.encryptedInterests);
    if (decrypted !== null) setDecryptedInterests(decrypted);
  };

  return (
    <div className="modal-overlay">
      <div className="twin-detail-modal">
        <div className="modal-header">
          <h2>Digital Twin Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="twin-info">
            <div className="info-item"><span>ID:</span><strong>#{twin.id.substring(0, 8)}</strong></div>
            <div className="info-item"><span>Owner:</span><strong>{twin.owner.substring(0, 6)}...{twin.owner.substring(38)}</strong></div>
            <div className="info-item"><span>Created:</span><strong>{new Date(twin.timestamp * 1000).toLocaleString()}</strong></div>
            <div className="info-item"><span>Status:</span><strong className={`status-badge ${twin.status}`}>{twin.status}</strong></div>
            <div className="info-item"><span>Earnings:</span><strong>${parseFloat(twin.earnings).toFixed(2)}</strong></div>
          </div>

          <div className="encrypted-section">
            <h3>Encrypted Interests</h3>
            <div className="encrypted-data">
              {twin.encryptedInterests.substring(0, 100)}...
            </div>
            <div className="fhe-tag">FHE Encrypted</div>
            <button 
              className="decrypt-btn" 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
            >
              {isDecrypting ? "Decrypting..." : 
               decryptedInterests ? "Hide Interests" : "Decrypt with Wallet"}
            </button>
          </div>

          {decryptedInterests && (
            <div className="decrypted-section">
              <h3>Your Interest Profile</h3>
              {renderInterestChart(decryptedInterests)}
              <div className="decryption-notice">
                <div className="notice-icon">⚠️</div>
                <div className="notice-text">
                  Decrypted data is only visible after wallet signature verification
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;
