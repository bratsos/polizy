import * as React from "react";

interface DbResetCountdownProps {
  intervalMinutes: number;
}

const calculateTimeLeft = (intervalMinutes: number): string => {
  const now = new Date();
  const currentMinutes = now.getMinutes();
  const currentSeconds = now.getSeconds();

  const minutesPastInterval = currentMinutes % intervalMinutes;
  const secondsUntilNextInterval =
    ((intervalMinutes - minutesPastInterval) * 60 -
      currentSeconds +
      intervalMinutes * 60) %
    (intervalMinutes * 60);

  const minutesLeft = Math.floor(secondsUntilNextInterval / 60);
  const secondsLeft = secondsUntilNextInterval % 60;

  return `${String(minutesLeft).padStart(2, "0")}:${String(
    secondsLeft
  ).padStart(2, "0")}`;
};

const DbResetCountdown: React.FC<DbResetCountdownProps> = ({
  intervalMinutes,
}) => {
  const [timeLeft, setTimeLeft] = React.useState<string>(() =>
    calculateTimeLeft(intervalMinutes)
  );

  React.useEffect(() => {
    let hasReloaded = false;
    const timerId = setInterval(() => {
      const newTimeLeft = calculateTimeLeft(intervalMinutes);
      setTimeLeft(newTimeLeft);

      if (newTimeLeft === "00:00" && !hasReloaded) {
        hasReloaded = true;
        console.log("Countdown finished. Reloading page...");
        setTimeout(() => {
          window.location.reload();
        }, 2000);
      } else if (newTimeLeft !== "00:00") {
        hasReloaded = false;
      }
    }, 1000);

    return () => clearInterval(timerId);
  }, [intervalMinutes]);

  return (
    <div className="text-sm text-gray-600 dark:text-gray-400 text-center my-4">
      <span>Next automatic DB reset in: </span>
      <span className="font-mono font-semibold">{timeLeft}</span>
    </div>
  );
};

export default DbResetCountdown;
