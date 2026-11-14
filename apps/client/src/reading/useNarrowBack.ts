import { useEffect, useRef } from "react";

export function useNarrowBack(
  onBackHandler: ((handler: (() => boolean) | undefined) => void) | undefined,
  showsDetail: boolean,
  action: () => boolean,
  detailKey?: boolean,
) {
  const back = useRef(onBackHandler);
  back.current = onBackHandler;
  const currentAction = useRef(action);
  currentAction.current = action;
  useEffect(() => {
    back.current?.(showsDetail ? () => currentAction.current() : undefined);
  }, [showsDetail, detailKey]);
  useEffect(() => () => back.current?.(undefined), []);
}
