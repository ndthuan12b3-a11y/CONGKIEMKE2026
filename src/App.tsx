/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { 
  FileText, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  Table as TableIcon,
  Download,
  Trash2,
  Plus,
  PlusCircle,
  X,
  LayoutDashboard,
  Keyboard,
  Copy,
  FileSpreadsheet,
  CloudCheck,
  HelpCircle,
  Edit2,
  Save,
  Info,
  RefreshCw,
  Copy as CopyIcon,
  Calculator,
  User,
  LogIn,
  LogOut,
  Search,
  ArrowRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import { db, serverTimestamp } from './firebase';
import { doc, setDoc, onSnapshot } from 'firebase/firestore';

// --- Types ---

interface InventoryItem {
  id: string;
  quantity: number | string;
  unitPrice: number | string;
  totalPrice: number;
}

interface Page {
  id: string;
  name: string;
  items: InventoryItem[];
}

interface Store {
  id: string;
  name: string;
  pages: Page[];
}

// --- Components ---

const InventoryRow = React.memo(({ 
  item, 
  index, 
  onUpdate, 
  onRemove, 
  onKeyDown,
  formatCurrency,
  formatNumberInput
}: { 
  item: InventoryItem; 
  index: number; 
  onUpdate: (field: keyof InventoryItem, value: string | number) => void;
  onRemove: () => void;
  onKeyDown: (e: React.KeyboardEvent, index: number, field: 'quantity' | 'unitPrice') => void;
  formatCurrency: (amount: number) => string;
  formatNumberInput: (val: string | number) => string;
}) => {
  return (
    <motion.div 
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      className="group relative grid grid-cols-1 gap-4 rounded-xl border border-slate-100 bg-slate-50/50 p-4 transition-all hover:border-blue-200 hover:bg-white hover:shadow-md sm:grid-cols-12 sm:items-center"
    >
      <div className="col-span-1 font-bold text-slate-300">#{index + 1}</div>
      <div className="col-span-3">
        <label className="mb-1 block text-[10px] font-bold uppercase text-slate-400 sm:hidden">Số lượng</label>
        <input 
          type="number" 
          placeholder="0"
          value={item.quantity}
          onChange={(e) => onUpdate('quantity', e.target.value)}
          onKeyDown={(e) => onKeyDown(e, index, 'quantity')}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-center focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all"
        />
      </div>
      <div className="col-span-3">
        <label className="mb-1 block text-[10px] font-bold uppercase text-slate-400 sm:hidden">Đơn giá</label>
        <input 
          type="text" 
          placeholder="0"
          value={formatNumberInput(item.unitPrice)}
          onChange={(e) => onUpdate('unitPrice', e.target.value)}
          onKeyDown={(e) => onKeyDown(e, index, 'unitPrice')}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-right focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all"
        />
      </div>
      <div className="col-span-4 text-right">
        <label className="mb-1 block text-[10px] font-bold uppercase text-slate-400 sm:hidden">Thành tiền</label>
        <div className="px-3 py-2 text-sm font-bold text-slate-900">
          {formatCurrency(item.totalPrice)}
        </div>
      </div>
      <div className="col-span-1 flex justify-end">
        <button 
          onClick={onRemove}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 hover:bg-red-50 hover:text-red-500 transition-all"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </motion.div>
  );
});

InventoryRow.displayName = 'InventoryRow';

export default function App() {
  
  // Session ID for persistence (Fixed default for global sync)
  const [sessionId, setSessionId] = useState<string>(() => {
    // 1. Check URL first (allows for separate databases if needed)
    const urlParams = new URLSearchParams(window.location.search);
    const s = urlParams.get('s');
    if (s) {
      localStorage.setItem('invoice_digitizer_session_id', s);
      return s;
    }
    
    // 2. Default to a fixed global ID for this project
    // This ensures every device opening the app sees the same data by default
    const defaultId = "main-system"; 
    localStorage.setItem('invoice_digitizer_session_id', defaultId);
    return defaultId;
  });

  const currentId = sessionId;

  useEffect(() => {
    setIsInitialLoadComplete(false);
  }, [currentId]);

  // Manual Hub State
  const [stores, setStores] = useState<Store[]>([
    { 
      id: crypto.randomUUID(), 
      name: 'Cửa hàng 1', 
      pages: [{ id: crypto.randomUUID(), name: 'Trang 1', items: [{ id: crypto.randomUUID(), quantity: '', unitPrice: '', totalPrice: 0 }] }] 
    }
  ]);
  const [activeStoreId, setActiveStoreId] = useState<string>(() => localStorage.getItem(`active_store_${currentId}`) || '');
  const [activePageId, setActivePageId] = useState<string>(() => localStorage.getItem(`active_page_${currentId}`) || '');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isInitialLoadComplete, setIsInitialLoadComplete] = useState(false);
  const isInitialLoadCompleteRef = useRef(false);
  const isDirtyRef = useRef(false);
  const lastServerDataRef = useRef<string>('');
  const storesRef = useRef(stores);
  storesRef.current = stores;
  const [showInstructions, setShowInstructions] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [syncInput, setSyncInput] = useState('');
  const [copySuccess, setCopySuccess] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const searchResults = useMemo(() => {
    if (!debouncedSearchTerm.trim()) return [];
    const term = debouncedSearchTerm.toLowerCase();
    const results: { storeId: string; storeName: string; pageId: string; pageName: string; item: InventoryItem; index: number }[] = [];

    stores.forEach(store => {
      const storeName = store.name.toLowerCase();
      store.pages.forEach(page => {
        const pageName = page.name.toLowerCase();
        page.items.forEach((item, index) => {
          const quantity = item.quantity.toString().toLowerCase();
          const unitPrice = item.unitPrice.toString().toLowerCase();
          const totalPrice = item.totalPrice.toString().toLowerCase();
          
          if (
            storeName.includes(term) ||
            pageName.includes(term) ||
            quantity.includes(term) || 
            unitPrice.includes(term) || 
            totalPrice.includes(term)
          ) {
            results.push({ 
              storeId: store.id, 
              storeName: store.name, 
              pageId: page.id, 
              pageName: page.name, 
              item, 
              index 
            });
          }
        });
      });
    });
    return results;
  }, [stores, debouncedSearchTerm]);

  const navigateToResult = (storeId: string, pageId: string) => {
    setActiveStoreId(storeId);
    setActivePageId(pageId);
    setSearchTerm('');
    setShowSearch(false);
  };
  
  const getPageTotal = (page: Page) => page.items.reduce((sum, item) => sum + item.totalPrice, 0);
  const getStoreTotal = (store: Store) => store.pages.reduce((sum, page) => sum + getPageTotal(page), 0);
  const allStoresGrandTotal = stores.reduce((sum, store) => sum + getStoreTotal(store), 0);

  // Confirmation Modal State
  const [confirmModal, setConfirmModal] = useState<{
    show: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    type: 'danger' | 'warning';
  }>({
    show: false,
    title: '',
    message: '',
    onConfirm: () => {},
    type: 'warning'
  });

  // Renaming State
  const [editingStoreId, setEditingStoreId] = useState<string | null>(null);
  const [editingPageId, setEditingPageId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  // Natural Sort Helper
  const naturalSort = (a: string, b: string) => {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  };

  const sortPages = (pages: Page[]) => {
    return [...pages].sort((a, b) => naturalSort(a.name, b.name));
  };

  const sortStores = (stores: Store[]) => {
    return [...stores].sort((a, b) => naturalSort(a.name, b.name));
  };

  const copySyncCode = () => {
    const shareUrl = `${window.location.origin}${window.location.pathname}?s=${currentId}`;
    navigator.clipboard.writeText(shareUrl);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  const handleSync = () => {
    if (syncInput.trim().length < 3) {
      setError("Mã không hợp lệ.");
      return;
    }
    
    setConfirmModal({
      show: true,
      title: 'Kết nối dữ liệu?',
      message: 'Ứng dụng sẽ tải dữ liệu từ mã bạn nhập. Dữ liệu hiện tại trên máy này có thể bị thay thế.',
      type: 'warning',
      onConfirm: () => {
        setSessionId(syncInput.trim());
        localStorage.setItem('invoice_digitizer_session_id', syncInput.trim());
        setShowSyncModal(false);
        setSyncInput('');
        setConfirmModal(prev => ({ ...prev, show: false }));
        
        // Update URL
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set('s', syncInput.trim());
        window.history.replaceState({}, '', newUrl.toString());
        
        window.location.reload();
      }
    });
  };

  // Set initial active store and page
  useEffect(() => {
    if (stores.length > 0 && !activeStoreId) {
      const firstStoreId = stores[0].id;
      setActiveStoreId(firstStoreId);
      localStorage.setItem(`active_store_${currentId}`, firstStoreId);
      if (stores[0].pages.length > 0) {
        const firstPageId = stores[0].pages[0].id;
        setActivePageId(firstPageId);
        localStorage.setItem(`active_page_${currentId}`, firstPageId);
      }
    }
  }, [stores, activeStoreId, currentId]);

  // Persist active selections
  useEffect(() => {
    if (activeStoreId) localStorage.setItem(`active_store_${currentId}`, activeStoreId);
    if (activePageId) localStorage.setItem(`active_page_${currentId}`, activePageId);
  }, [activeStoreId, activePageId, currentId]);

  const activeStore = stores.find(s => s.id === activeStoreId) || stores[0] || { id: '', name: '', pages: [] };
  const activePage = activeStore.pages.find(p => p.id === activePageId) || activeStore.pages[0] || { id: '', name: '', items: [] };

  // --- Firestore Data Sync ---
  // Load data
  useEffect(() => {
    // Try to load from localStorage first for instant UI
    const localData = localStorage.getItem(`invoice_data_${currentId}`);
    if (localData) {
      try {
        const parsed = JSON.parse(localData);
        if (parsed.stores) {
          setStores(parsed.stores);
          if (parsed.stores.length > 0) {
            setActiveStoreId(parsed.stores[0].id);
            setActivePageId(parsed.stores[0].pages[0].id);
          }
        }
      } catch (e) {
        console.error("Local Load Error:", e);
      }
    }

    const docRef = doc(db, 'inventorySessions', currentId);
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      // If we have pending local writes, don't overwrite local state with server state
      // unless it's the very first load.
      if (docSnap.metadata.hasPendingWrites && isInitialLoadCompleteRef.current) return;

      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.stores) {
          // Ensure everything is sorted on load
          const sortedStores = sortStores(data.stores.map((s: Store) => ({
            ...s,
            pages: sortPages(s.pages)
          })));
          
          const newStr = JSON.stringify(sortedStores);
          lastServerDataRef.current = newStr;
          
          // Only update if data is actually different to avoid unnecessary re-renders
          setStores(prev => {
            const currentStr = JSON.stringify(prev);
            if (currentStr !== newStr) {
              if (isDirtyRef.current) {
                // Ignore server update while user is typing to prevent data loss
                return prev;
              }
              return sortedStores;
            }
            return prev;
          });
        } else if (data.pages) {
          // Migration for old data format
          setStores([{
            id: crypto.randomUUID(),
            name: 'Cửa hàng 1',
            pages: sortPages(data.pages)
          }]);
        }
      }
      
      if (!isInitialLoadCompleteRef.current) {
        isInitialLoadCompleteRef.current = true;
        setIsInitialLoadComplete(true);
      }
    }, (err) => {
      console.error("Firestore Load Error:", err);
      setError("Không thể tải dữ liệu từ đám mây.");
      if (!isInitialLoadCompleteRef.current) {
        isInitialLoadCompleteRef.current = true;
        setIsInitialLoadComplete(true);
      }
    });

    return () => unsubscribe();
  }, [currentId]);

  // Save data (Debounced)
  useEffect(() => {
    // CRITICAL: Don't save until we've successfully loaded the initial state from the cloud
    // to avoid overwriting cloud data with local default state.
    if (!isInitialLoadComplete) return;
    
    const currentStr = JSON.stringify(stores);
    if (currentStr === lastServerDataRef.current) {
      // No local changes, do nothing
      isDirtyRef.current = false;
      return;
    }

    // We have local changes!
    isDirtyRef.current = true;
    
    const timer = setTimeout(async () => {
      setIsSaving(true);
      
      // Always save to localStorage for local-only persistence
      localStorage.setItem(`invoice_data_${currentId}`, JSON.stringify({
        stores,
        updatedAt: new Date().toISOString()
      }));

      try {
        const docRef = doc(db, 'inventorySessions', currentId);
        await setDoc(docRef, {
          userId: currentId,
          stores: stores,
          grandTotal: allStoresGrandTotal,
          updatedAt: serverTimestamp()
        }, { merge: true });
        
        lastServerDataRef.current = currentStr;
        if (storesRef.current === stores) {
          isDirtyRef.current = false;
        }
        setLastSaved(new Date());
      } catch (err) {
        console.error("Firestore Save Error:", err);
        setError("Lỗi khi lưu dữ liệu lên đám mây.");
      } finally {
        setIsSaving(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [stores, currentId, isInitialLoadComplete, allStoresGrandTotal]);

  // --- Manual Hub Logic ---
  const addStore = () => {
    const newStore: Store = {
      id: crypto.randomUUID(),
      name: `Cửa hàng ${stores.length + 1}`,
      pages: [{ id: crypto.randomUUID(), name: 'Trang 1', items: [{ id: crypto.randomUUID(), quantity: '', unitPrice: '', totalPrice: 0 }] }]
    };
    const updatedStores = sortStores([...stores, newStore]);
    setStores(updatedStores);
    setActiveStoreId(newStore.id);
    setActivePageId(newStore.pages[0].id);
  };

  const removeStore = (id: string) => {
    const store = stores.find(s => s.id === id);
    if (!store) return;

    setConfirmModal({
      show: true,
      title: 'Xóa cửa hàng?',
      message: `Bạn có chắc chắn muốn xóa "${store.name}"? Toàn bộ dữ liệu trong cửa hàng này sẽ bị mất vĩnh viễn.`,
      type: 'danger',
      onConfirm: () => {
        if (stores.length > 1) {
          const newStores = stores.filter(s => s.id !== id);
          setStores(newStores);
          if (activeStoreId === id) {
            setActiveStoreId(newStores[0].id);
            setActivePageId(newStores[0].pages[0].id);
          }
        }
        setConfirmModal(prev => ({ ...prev, show: false }));
      }
    });
  };

  const renameStore = (id: string, newName: string) => {
    if (!newName.trim()) return;
    setStores(prev => sortStores(prev.map(s => s.id === id ? { ...s, name: newName } : s)));
    setEditingStoreId(null);
  };

  const addPage = (storeId: string) => {
    setStores(prev => prev.map(s => {
      if (s.id === storeId) {
        const newPage: Page = {
          id: crypto.randomUUID(),
          name: `Trang ${s.pages.length + 1}`,
          items: [{ id: crypto.randomUUID(), quantity: '', unitPrice: '', totalPrice: 0 }]
        };
        return { ...s, pages: sortPages([...s.pages, newPage]) };
      }
      return s;
    }));
  };

  const removePage = (storeId: string, pageId: string) => {
    const store = stores.find(s => s.id === storeId);
    const page = store?.pages.find(p => p.id === pageId);
    if (!page) return;

    setConfirmModal({
      show: true,
      title: 'Xóa trang tính?',
      message: `Bạn có chắc chắn muốn xóa "${page.name}"?`,
      type: 'danger',
      onConfirm: () => {
        setStores(prev => prev.map(s => {
          if (s.id === storeId) {
            if (s.pages.length > 1) {
              const newPages = s.pages.filter(p => p.id !== pageId);
              if (activePageId === pageId) {
                setActivePageId(newPages[0].id);
              }
              return { ...s, pages: newPages };
            }
          }
          return s;
        }));
        setConfirmModal(prev => ({ ...prev, show: false }));
      }
    });
  };

  const renamePage = (storeId: string, pageId: string, newName: string) => {
    if (!newName.trim()) return;
    setStores(prev => prev.map(s => {
      if (s.id === storeId) {
        const updatedPages = s.pages.map(p => p.id === pageId ? { ...p, name: newName } : p);
        return { ...s, pages: sortPages(updatedPages) };
      }
      return s;
    }));
    setEditingPageId(null);
  };

  const addManualRow = useCallback((storeId: string, pageId: string) => {
    setStores(prev => prev.map(s => {
      if (s.id === storeId) {
        return {
          ...s,
          pages: s.pages.map(p => {
            if (p.id === pageId) {
              return { ...p, items: [...p.items, { id: crypto.randomUUID(), quantity: '', unitPrice: '', totalPrice: 0 }] };
            }
            return p;
          })
        };
      }
      return s;
    }));
  }, []);

  const removeManualRow = useCallback((storeId: string, pageId: string, itemId: string) => {
    setStores(prev => prev.map(s => {
      if (s.id === storeId) {
        return {
          ...s,
          pages: s.pages.map(p => {
            if (p.id === pageId) {
              const newItems = p.items.filter(i => i.id !== itemId);
              return { ...p, items: newItems.length > 0 ? newItems : [{ id: crypto.randomUUID(), quantity: '', unitPrice: '', totalPrice: 0 }] };
            }
            return p;
          })
        };
      }
      return s;
    }));
  }, []);

  const updateManualItem = useCallback((storeId: string, pageId: string, itemId: string, field: keyof InventoryItem, value: string | number) => {
    setStores(prev => prev.map(s => {
      if (s.id === storeId) {
        return {
          ...s,
          pages: s.pages.map(p => {
            if (p.id === pageId) {
              const newItems = p.items.map(item => {
                if (item.id === itemId) {
                  let processedValue = value;
                  if (field === 'unitPrice' && typeof value === 'string') {
                    let tempValue = value.toLowerCase();
                    // Allow user to type 'k' to quickly add '000'
                    if (tempValue.includes('k')) {
                      tempValue = tempValue.replace(/k/g, '000');
                    }
                    processedValue = tempValue.replace(/\D/g, '');
                  }
                  const updatedItem = { ...item, [field]: processedValue };
                  const q = Number(updatedItem.quantity) || 0;
                  const pVal = Number(updatedItem.unitPrice) || 0;
                  updatedItem.totalPrice = q * pVal;
                  return updatedItem;
                }
                return item;
              });
              return { ...p, items: newItems };
            }
            return p;
          })
        };
      }
      return s;
    }));
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent, index: number, field: 'quantity' | 'unitPrice') => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const items = activePage.items;
      
      if (index < items.length - 1) {
        // Focus same field in next row
        const currentRow = e.currentTarget.closest('.group');
        const nextRow = currentRow?.nextElementSibling;
        if (nextRow) {
          const inputs = nextRow.querySelectorAll('input');
          const targetInput = field === 'quantity' ? inputs[0] : inputs[1];
          const input = targetInput as HTMLInputElement;
          input?.focus();
          input?.select();
        }
      } else {
        // Last row, add new row and focus it
        addManualRow(activeStore.id, activePage.id);
        
        // Use a small timeout to wait for the new row to be rendered
        setTimeout(() => {
          const container = document.querySelector('.space-y-3');
          if (container) {
            const rows = container.querySelectorAll('.group');
            const lastRow = rows[rows.length - 1];
            if (lastRow) {
              const inputs = lastRow.querySelectorAll('input');
              const targetInput = field === 'quantity' ? inputs[0] : inputs[1];
              const input = targetInput as HTMLInputElement;
              input?.focus();
              input?.select();
            }
          }
        }, 50);
      }
    }
  }, [activePage.items, activeStore.id, activePage.id, addManualRow]);

  const formatNumberInput = (val: string | number) => {
    if (val === '' || val === undefined || val === null) return '';
    const numStr = val.toString().replace(/\D/g, '');
    if (!numStr) return '';
    return numStr.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  };

  const exportStoreToExcel = (store: Store) => {
    const wb = XLSX.utils.book_new();
    const wsData: any[][] = [];
    
    let maxItems = 0;
    store.pages.forEach(page => {
      maxItems = Math.max(maxItems, page.items.length);
    });

    // Header Row 1: Page Names
    const headerRow1: any[] = [];
    const headerRow2: any[] = [];
    
    store.pages.forEach((page, pIdx) => {
      const startCol = pIdx * 5;
      headerRow1[startCol] = page.name.toUpperCase();
      headerRow2[startCol] = "STT";
      headerRow2[startCol + 1] = "Số lượng";
      headerRow2[startCol + 2] = "Đơn giá";
      headerRow2[startCol + 3] = "Thành tiền";
    });

    wsData.push(headerRow1);
    wsData.push(headerRow2);

    for (let i = 0; i < maxItems; i++) {
      const row: any[] = [];
      store.pages.forEach((page, pIdx) => {
        const startCol = pIdx * 5;
        const item = page.items[i];
        if (item) {
          row[startCol] = i + 1;
          row[startCol + 1] = item.quantity === '' ? null : Number(item.quantity);
          row[startCol + 2] = item.unitPrice === '' ? null : Number(item.unitPrice);
          row[startCol + 3] = item.totalPrice || null;
        }
      });
      wsData.push(row);
    }

    // Totals Row
    const totalsRow: any[] = [];
    store.pages.forEach((page, pIdx) => {
      const startCol = pIdx * 5;
      totalsRow[startCol] = "TỔNG CỘNG";
      totalsRow[startCol + 3] = getPageTotal(page);
    });
    wsData.push(totalsRow);

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    
    // Set column widths
    const wscols = [];
    for (let p = 0; p < store.pages.length; p++) {
      wscols.push({ wch: 5 });  // STT
      wscols.push({ wch: 10 }); // Số lượng
      wscols.push({ wch: 15 }); // Đơn giá
      wscols.push({ wch: 20 }); // Thành tiền
      wscols.push({ wch: 2 });  // Gap
    }
    ws['!cols'] = wscols;

    XLSX.utils.book_append_sheet(wb, ws, store.name.substring(0, 31));
    XLSX.writeFile(wb, `Bao_cao_${store.name.replace(/\s+/g, '_')}.xlsx`);
  };

  const exportAllToExcel = () => {
    const wb = XLSX.utils.book_new();
    
    // Summary Sheet
    const summaryData: any[][] = [
      ["BÁO CÁO TỔNG HỢP TẤT CẢ CỬA HÀNG"],
      [],
      ["Tên Cửa Hàng", "Tổng Cộng"]
    ];
    
    stores.forEach(store => {
      summaryData.push([store.name, getStoreTotal(store)]);
    });
    
    summaryData.push([]);
    summaryData.push(["TỔNG CỘNG TOÀN BỘ", allStoresGrandTotal]);
    
    const summaryWs = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, summaryWs, "Tổng hợp");

    // Individual Store Sheets
    stores.forEach(store => {
      const wsData: any[][] = [];
      const headerRow1: any[] = [];
      const headerRow2: any[] = [];
      
      let maxItems = 0;
      store.pages.forEach(page => {
        maxItems = Math.max(maxItems, page.items.length);
      });

      store.pages.forEach((page, pIdx) => {
        const startCol = pIdx * 5;
        headerRow1[startCol] = page.name.toUpperCase();
        headerRow2[startCol] = "STT";
        headerRow2[startCol + 1] = "Số lượng";
        headerRow2[startCol + 2] = "Đơn giá";
        headerRow2[startCol + 3] = "Thành tiền";
      });

      wsData.push(headerRow1);
      wsData.push(headerRow2);

      for (let i = 0; i < maxItems; i++) {
        const row: any[] = [];
        store.pages.forEach((page, pIdx) => {
          const startCol = pIdx * 5;
          const item = page.items[i];
          if (item) {
            row[startCol] = i + 1;
            row[startCol + 1] = item.quantity === '' ? null : Number(item.quantity);
            row[startCol + 2] = item.unitPrice === '' ? null : Number(item.unitPrice);
            row[startCol + 3] = item.totalPrice || null;
          }
        });
        wsData.push(row);
      }

      const totalsRow: any[] = [];
      store.pages.forEach((page, pIdx) => {
        const startCol = pIdx * 5;
        totalsRow[startCol] = "TỔNG CỘNG";
        totalsRow[startCol + 3] = getPageTotal(page);
      });
      wsData.push(totalsRow);

      const ws = XLSX.utils.aoa_to_sheet(wsData);
      
      // Set column widths
      const wscols = [];
      for (let p = 0; p < store.pages.length; p++) {
        wscols.push({ wch: 5 });  // STT
        wscols.push({ wch: 10 }); // Số lượng
        wscols.push({ wch: 15 }); // Đơn giá
        wscols.push({ wch: 20 }); // Thành tiền
        wscols.push({ wch: 2 });  // Gap
      }
      ws['!cols'] = wscols;

      XLSX.utils.book_append_sheet(wb, ws, store.name.substring(0, 31));
    });

    XLSX.writeFile(wb, "Bao_cao_tong_hop_toan_bo.xlsx");
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('vi-VN').format(amount);
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 selection:bg-blue-100">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-200">
              <TableIcon className="h-6 w-6" />
            </div>
            <div className="hidden sm:block">
              <h1 className="text-xl font-bold tracking-tight text-slate-900">Invoice Digitizer Pro</h1>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Hệ thống số hóa</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <div className="relative hidden md:block">
              <div className={cn(
                "flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 transition-all focus-within:border-blue-500 focus-within:bg-white focus-within:ring-2 focus-within:ring-blue-100",
                showSearch ? "w-64" : "w-10"
              )}>
                <Search 
                  className="h-4 w-4 text-slate-400 cursor-pointer" 
                  onClick={() => {
                    setShowSearch(!showSearch);
                    if (showSearch) setSearchTerm('');
                  }}
                />
                {showSearch && (
                  <input 
                    type="text"
                    placeholder="Tìm kiếm dữ liệu..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    autoFocus
                    className="w-full bg-transparent text-sm outline-none"
                  />
                )}
              </div>
              
              {/* Search Results Dropdown */}
              <AnimatePresence>
                {searchTerm.trim() !== '' && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="absolute right-0 top-full mt-2 w-80 max-h-96 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl z-50"
                  >
                    <div className="mb-2 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                      Kết quả tìm kiếm ({searchResults.length})
                    </div>
                    {searchResults.length > 0 ? (
                      <div className="space-y-1">
                        {searchResults.map((result, i) => (
                          <button
                            key={`${result.item.id}-${i}`}
                            onClick={() => navigateToResult(result.storeId, result.pageId)}
                            className="flex w-full flex-col rounded-xl p-3 text-left transition-all hover:bg-blue-50"
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-bold text-blue-600">{result.storeName} › {result.pageName}</span>
                              <span className="text-[10px] font-bold text-slate-300">#{result.index + 1}</span>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-slate-600">SL: {result.item.quantity}</span>
                              <span className="font-bold text-slate-900">{formatCurrency(result.item.totalPrice)}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="px-3 py-8 text-center text-sm text-slate-400">
                        Không tìm thấy kết quả nào cho "{searchTerm}"
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="hidden flex-col items-end sm:flex">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Tổng tất cả</p>
              <p className="text-lg font-black text-blue-600">{formatCurrency(allStoresGrandTotal)}</p>
            </div>
            
            <div className="h-8 w-px bg-slate-200 mx-2 hidden sm:block"></div>

              <div className="flex items-center gap-3">
                <button 
                  onClick={() => setShowSyncModal(true)}
                  className="flex h-10 items-center gap-2 rounded-xl bg-amber-50 px-3 text-sm font-bold text-amber-600 transition-all hover:bg-amber-100"
                  title="Chia sẻ & Đồng bộ"
                >
                  <RefreshCw className={cn("h-4 w-4", isSaving && "animate-spin")} />
                  <span className="hidden md:inline">Chia sẻ</span>
                </button>

                <button 
                  onClick={() => setShowInstructions(!showInstructions)}
                  className="flex h-10 items-center gap-2 rounded-xl bg-blue-50 px-3 text-sm font-bold text-blue-600 transition-all hover:bg-blue-100"
                >
                  <HelpCircle className="h-4 w-4" />
                  <span className="hidden md:inline">Hướng dẫn</span>
                </button>

                <div className="h-8 w-px bg-slate-200 mx-1 hidden sm:block"></div>

                <div className="flex flex-col items-end lg:flex">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Hệ thống đồng bộ </p>
                  <div className="flex items-center gap-1">
                    {isSaving ? (
                      <span className="flex items-center gap-1 text-[9px] text-amber-500 font-bold uppercase">
                        <Loader2 className="h-2.5 w-2.5 animate-spin" /> Đang lưu...
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[9px] text-green-500 font-bold uppercase">
                        <CloudCheck className="h-2.5 w-2.5" /> Đã kết nối
                      </span>
                    )}
                  </div>
                </div>
              </div>

            <button 
              onClick={exportAllToExcel}
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-600 text-white shadow-lg shadow-green-100 transition-all hover:bg-green-700"
              title="Xuất tất cả cửa hàng (Excel)"
            >
              <FileSpreadsheet className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Instructions Section */}
        <AnimatePresence>
          {showInstructions && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="mb-8 overflow-hidden rounded-2xl bg-blue-600 p-6 text-white shadow-xl shadow-blue-100"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="rounded-full bg-white/20 p-2">
                    <Info className="h-6 w-6" />
                  </div>
                  <h3 className="text-xl font-bold">Hướng dẫn sử dụng nhanh</h3>
                </div>
                <button onClick={() => setShowInstructions(false)} className="rounded-full p-1 hover:bg-white/10">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="mt-6 grid gap-6 md:grid-cols-2">
                <div className="rounded-xl bg-white/10 p-4 backdrop-blur-sm">
                  <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-full bg-white font-bold text-blue-600">1</div>
                  <p className="mb-1 font-bold">Phân loại Cửa hàng</p>
                  <p className="text-xs text-blue-100">Thêm các cửa hàng khác nhau để quản lý dữ liệu kho riêng biệt.</p>
                </div>
                <div className="rounded-xl bg-white/10 p-4 backdrop-blur-sm">
                  <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-full bg-white font-bold text-blue-600">2</div>
                  <p className="mb-1 font-bold">Quản lý & Xuất file</p>
                  <p className="text-xs text-blue-100">Click đúp để đổi tên Trang/Cửa hàng. Hệ thống tự sắp xếp thứ tự và xuất Excel riêng biệt.</p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence mode="wait">
          <motion.div 
            key="manual-hub"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              {/* Store & Page Navigation */}
              <div className="space-y-6">
                {/* Store Tabs */}
                <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-4">
                  <p className="mr-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Cửa hàng:</p>
                  {stores.map(s => (
                    <div key={s.id} className="group relative">
                      {editingStoreId === s.id ? (
                        <div className="flex items-center gap-1 rounded-xl bg-white p-1 shadow-md">
                          <input 
                            autoFocus
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && renameStore(s.id, editValue)}
                            className="w-24 border-none bg-transparent px-2 py-1 text-sm font-bold outline-none"
                          />
                          <button onClick={() => renameStore(s.id, editValue)} className="text-green-500 hover:text-green-600">
                            <CheckCircle2 className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <button 
                          onClick={() => {
                            setActiveStoreId(s.id);
                            setActivePageId(s.pages[0].id);
                          }}
                          onDoubleClick={() => { setEditingStoreId(s.id); setEditValue(s.name); }}
                          className={cn(
                            "flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-all",
                            activeStoreId === s.id ? "bg-slate-900 text-white shadow-lg" : "bg-white text-slate-500 hover:bg-slate-100"
                          )}
                        >
                          <LayoutDashboard className="h-4 w-4" />
                          {s.name}
                        </button>
                      )}
                      {stores.length > 1 && editingStoreId !== s.id && (
                        <div className="absolute -right-1 -top-1 hidden gap-1 group-hover:flex">
                          <button 
                            onClick={(e) => { e.stopPropagation(); setEditingStoreId(s.id); setEditValue(s.name); }}
                            className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-500 text-white shadow-sm"
                          >
                            <Edit2 className="h-3 w-3" />
                          </button>
                          <button 
                            onClick={(e) => { e.stopPropagation(); removeStore(s.id); }}
                            className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white shadow-sm"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                  <button 
                    onClick={addStore}
                    className="flex h-9 w-9 items-center justify-center rounded-xl border border-dashed border-slate-300 text-slate-400 transition-all hover:border-blue-400 hover:text-blue-600"
                    title="Thêm cửa hàng mới"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>

                {/* Page Tabs */}
                <div className="flex flex-wrap items-center gap-2">
                  <p className="mr-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Trang tính:</p>
                  {activeStore.pages.map(p => (
                    <div key={p.id} className="group relative">
                      {editingPageId === p.id ? (
                        <div className="flex items-center gap-1 rounded-xl bg-white p-1 shadow-md">
                          <input 
                            autoFocus
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && renamePage(activeStore.id, p.id, editValue)}
                            className="w-24 border-none bg-transparent px-2 py-1 text-sm font-bold outline-none"
                          />
                          <button onClick={() => renamePage(activeStore.id, p.id, editValue)} className="text-green-500 hover:text-green-600">
                            <CheckCircle2 className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <button 
                          onClick={() => setActivePageId(p.id)}
                          onDoubleClick={() => { setEditingPageId(p.id); setEditValue(p.name); }}
                          className={cn(
                            "flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-all",
                            activePage.id === p.id ? "bg-blue-600 text-white shadow-lg shadow-blue-100" : "bg-white text-slate-500 hover:bg-slate-100"
                          )}
                        >
                          <FileText className="h-4 w-4" />
                          {p.name}
                          <span className="ml-1 text-[10px] opacity-60">({formatCurrency(getPageTotal(p))})</span>
                        </button>
                      )}
                      {activeStore.pages.length > 1 && editingPageId !== p.id && (
                        <div className="absolute -right-1 -top-1 hidden gap-1 group-hover:flex">
                          <button 
                            onClick={(e) => { e.stopPropagation(); setEditingPageId(p.id); setEditValue(p.name); }}
                            className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-500 text-white shadow-sm"
                          >
                            <Edit2 className="h-3 w-3" />
                          </button>
                          <button 
                            onClick={(e) => { e.stopPropagation(); removePage(activeStore.id, p.id); }}
                            className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white shadow-sm"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                  <button 
                    onClick={() => addPage(activeStoreId)}
                    className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-blue-600 shadow-sm transition-all hover:bg-blue-50"
                    title="Thêm trang mới"
                  >
                    <Plus className="h-5 w-5" />
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-blue-600 font-bold text-xs uppercase tracking-widest mb-1">
                      <LayoutDashboard className="h-3 w-3" />
                      {activeStore.name}
                    </div>
                    <h2 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
                      <Keyboard className="h-6 w-6 text-blue-600" />
                      {activePage.name}
                    </h2>
                    <p className="text-sm text-slate-500">Nhập liệu cho {activeStore.name} • {activePage.name}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={() => exportStoreToExcel(activeStore)}
                      className="flex items-center gap-2 rounded-xl bg-green-50 px-4 py-2 text-sm font-bold text-green-600 transition-all hover:bg-green-100"
                    >
                      <FileSpreadsheet className="h-4 w-4" />
                      Xuất {activeStore.name}
                    </button>
                    <div className="flex items-center gap-4 rounded-2xl bg-blue-600 px-6 py-4 text-white shadow-lg shadow-blue-100">
                      <div className="text-right">
                        <p className="text-[10px] font-bold uppercase tracking-widest opacity-80">Tổng trang hiện tại</p>
                        <p className="text-2xl font-black">{formatCurrency(getPageTotal(activePage))}</p>
                      </div>
                      <Calculator className="h-8 w-8 opacity-50" />
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="hidden grid-cols-12 gap-4 px-4 py-2 text-xs font-bold uppercase tracking-wider text-slate-400 sm:grid">
                    <div className="col-span-1">STT</div>
                    <div className="col-span-3 text-center">Số lượng</div>
                    <div className="col-span-3 text-right">Đơn giá</div>
                    <div className="col-span-4 text-right">Thành tiền</div>
                    <div className="col-span-1"></div>
                  </div>

                  <div className="space-y-3">
                    <AnimatePresence initial={false}>
                      {activePage.items.map((item, index) => (
                        <InventoryRow
                          key={item.id}
                          item={item}
                          index={index}
                          onUpdate={(field, value) => updateManualItem(activeStore.id, activePage.id, item.id, field, value)}
                          onRemove={() => removeManualRow(activeStore.id, activePage.id, item.id)}
                          onKeyDown={handleKeyDown}
                          formatCurrency={formatCurrency}
                          formatNumberInput={formatNumberInput}
                        />
                      ))}
                    </AnimatePresence>
                  </div>

                  <button 
                    onClick={() => addManualRow(activeStore.id, activePage.id)}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 py-4 text-sm font-bold text-slate-400 transition-all hover:border-blue-400 hover:bg-blue-50 hover:text-blue-600"
                  >
                    <PlusCircle className="h-5 w-5" />
                    Thêm dòng mới vào {activePage.name}
                  </button>
                </div>
              </div>
            </motion.div>
        </AnimatePresence>
      </main>

      <footer className="mt-auto border-t border-slate-200 bg-white py-8">
        <div className="mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
          <p className="text-sm text-slate-400">
            © 2026 Invoice Digitizer Pro • Giải pháp số hóa & nhập liệu kho đa trang
          </p>
        </div>
      </footer>

      {/* Sync Modal */}
      <AnimatePresence>
        {showSyncModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSyncModal(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md overflow-hidden rounded-3xl bg-white p-8 shadow-2xl"
            >
              <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-amber-50 text-amber-500">
                <RefreshCw className="h-8 w-8" />
              </div>
              <h3 className="mb-2 text-2xl font-bold text-slate-900">Chia sẻ & Đồng bộ</h3>
              <p className="mb-6 text-sm text-slate-500 leading-relaxed">
                Để xem dữ liệu này trên máy khác, bạn chỉ cần <strong>sao chép liên kết</strong> dưới đây và mở nó trên thiết bị đó.
              </p>

              <div className="mb-8 space-y-4">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Liên kết chia sẻ của bạn:</p>
                  <div className="flex items-center justify-between gap-2">
                    <code className="flex-1 overflow-hidden text-ellipsis font-mono text-xs font-bold text-blue-600">
                      {window.location.origin}{window.location.pathname}?s={currentId}
                    </code>
                    <button 
                      onClick={copySyncCode}
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-slate-400 shadow-sm transition-all hover:text-blue-600"
                      title="Sao chép liên kết"
                    >
                      {copySuccess ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <CopyIcon className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-3 py-2">
                  <div className="h-px flex-1 bg-slate-100"></div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-300">Hoặc nhập mã thủ công</span>
                  <div className="h-px flex-1 bg-slate-100"></div>
                </div>

                <div>
                  <div className="flex gap-2">
                    <input 
                      type="text"
                      placeholder="Nhập mã (ví dụ: 8a2b1c)..."
                      value={syncInput}
                      onChange={(e) => setSyncInput(e.target.value)}
                      className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />
                    <button 
                      onClick={handleSync}
                      className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-blue-100 transition-all hover:bg-blue-700"
                    >
                      Kết nối
                    </button>
                  </div>
                </div>
              </div>

              <button 
                onClick={() => setShowSyncModal(false)}
                className="w-full rounded-2xl bg-slate-100 py-4 font-bold text-slate-600 transition-all hover:bg-slate-200"
              >
                Đóng
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Confirmation Modal */}
      <AnimatePresence>
        {confirmModal.show && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setConfirmModal(prev => ({ ...prev, show: false }))}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md overflow-hidden rounded-3xl bg-white p-8 shadow-2xl"
            >
              <div className={cn(
                "mb-6 flex h-16 w-16 items-center justify-center rounded-full",
                confirmModal.type === 'danger' ? "bg-red-50 text-red-500" : "bg-amber-50 text-amber-500"
              )}>
                <AlertCircle className="h-8 w-8" />
              </div>
              <h3 className="mb-2 text-2xl font-bold text-slate-900">{confirmModal.title}</h3>
              <p className="mb-8 text-slate-500 leading-relaxed">{confirmModal.message}</p>
              <div className="flex gap-3">
                <button 
                  onClick={() => setConfirmModal(prev => ({ ...prev, show: false }))}
                  className="flex-1 rounded-2xl bg-slate-100 py-4 font-bold text-slate-600 transition-all hover:bg-slate-200"
                >
                  Hủy bỏ
                </button>
                <button 
                  onClick={confirmModal.onConfirm}
                  className={cn(
                    "flex-1 rounded-2xl py-4 font-bold text-white shadow-lg transition-all",
                    confirmModal.type === 'danger' ? "bg-red-500 shadow-red-100 hover:bg-red-600" : "bg-blue-600 shadow-blue-100 hover:bg-blue-700"
                  )}
                >
                  Xác nhận
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
