// components/LinkDependent.jsx
export function LinkDependent() {
  const [code, setCode] = useState('');

  const handleLink = () => {
    fetch('/api/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guardianId: 'current-user-id',
        code
      })
    });
  };

  return (
    <div>
      <input 
        value={code}
        onChange={(e) => setCode(e.targetValue)}
        placeholder="Введите код подопечного"
      />
      <button onClick={handleLink}>Привязать</button>
    </div>
  );
}