export default function StatusPill({status}){
  const m={
    // legacy
    pending:['Pending','sp-pending'], transit:['In Transit','sp-transit'], delivered:['Delivered','sp-delivered'],
    Active:['Active','sp-active'], 'Pending Review':['Pending Review','sp-review'],
    // order lifecycle stages
    placed:['Placed','sp-pending'], confirmed:['Confirmed','sp-transit'], packed:['Packed','sp-transit'],
    dispatched:['Dispatched','sp-transit'], in_transit:['In Transit','sp-transit'],
    out_for_delivery:['Out for Delivery','sp-transit'], cancelled:['Cancelled','sp-review'],
  };
  const [label,cls]=m[status]||[status,''];
  return <span className={`spill ${cls}`}>{label}</span>;
}
