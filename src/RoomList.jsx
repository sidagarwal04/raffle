import { Link } from "react-router-dom";

export function RoomList({ rooms }) {
  if (!rooms.length) return <p className="muted">Rooms you open are saved here.</p>;
  return (
    <ul className="saved">
      {rooms.map((room) => (
        <li key={room.code}>
          <Link to={`/s/${room.code}`}>
            <span>
              <strong>{room.code}</strong>
              <em>
                {room.title}
                {room.role === "collaborator" ? " · Shared" : ""}
                {room.latestName ? ` · ${room.latestName}` : " · No draw yet"}
              </em>
            </span>
            <em>{room.count} in</em>
          </Link>
        </li>
      ))}
    </ul>
  );
}
