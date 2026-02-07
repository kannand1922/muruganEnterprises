import { AlertCircle, CheckCircle, XCircle } from "lucide-react";
import { useEffect } from "react";

// Toast Notification Component
const Toast = ({ message, type, onClose }) => {
    useEffect(() => {
      const timer = setTimeout(onClose, 3000);
      return () => clearTimeout(timer);
    }, [onClose]);
  
    const icons = {
      success: <CheckCircle className="w-5 h-5" />,
      error: <XCircle className="w-5 h-5" />,
      info: <AlertCircle className="w-5 h-5" />
    };
  
    const colors = {
      success: 'bg-green-50 border-green-500 text-green-800',
      error: 'bg-red-50 border-red-500 text-red-800',
      info: 'bg-blue-50 border-blue-500 text-blue-800'
    };
  
    return (
      <div className={`fixed top-4 right-4 p-4 rounded-lg border-l-4 shadow-lg flex items-center gap-3 ${colors[type]} z-50 animate-fade-in`}>
        {icons[type]}
        <span className="font-medium">{message}</span>
      </div>
    );
  };
  

  export default Toast