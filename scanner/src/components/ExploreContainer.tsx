import { IonText } from "@ionic/react";

type ExploreContainerProps = {
  name: string;
};

export default function ExploreContainer({ name }: ExploreContainerProps) {
  return (
    <div className="ion-padding">
      <IonText color="medium">
        <p>{name}</p>
      </IonText>
    </div>
  );
}
