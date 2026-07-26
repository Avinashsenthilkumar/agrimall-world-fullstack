'use client';
import { createContext, useContext, useReducer } from 'react';

const AppContext = createContext(null);

function reducer(state, action) {
  switch (action.type) {
    case 'ADD': {
      const qty = (state.cart[action.id] || 0) + (action.qty || 1);
      return { ...state, cart: { ...state.cart, [action.id]: qty } };
    }
    case 'SET_QTY': {
      const next = { ...state.cart };
      if (action.qty <= 0) delete next[action.id];
      else next[action.id] = action.qty;
      return { ...state, cart: next };
    }
    case 'REMOVE': {
      const next = { ...state.cart };
      delete next[action.id];
      return { ...state, cart: next };
    }
    case 'CLEAR_CART': return { ...state, cart: {} };
    case 'SET_ORDER': return { ...state, pendingOrder: action.order };
    case 'ADD_SELLER': return { ...state, sellers: [...state.sellers, action.seller] };
    default: return state;
  }
}

const initialState = {
  cart: {},
  pendingOrder: null,
  sellers: [],
};

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  return <AppContext.Provider value={{ state, dispatch }}>{children}</AppContext.Provider>;
}

export function useApp() {
  return useContext(AppContext);
}
