import QtQuick

Item {
    id: root

    default property alias content: contentLayer.data
    property real cornerRadius: 22
    property real glassOpacity: 0.66
    property color tintColor: "#CCFFFFFF"
    property color borderColor: "#7AFFFFFF"
    property bool shadowEnabled: true

    implicitWidth: 260
    implicitHeight: 180

    Rectangle {
        anchors.fill: parent
        anchors.leftMargin: root.shadowEnabled ? 0 : 0
        anchors.rightMargin: root.shadowEnabled ? 0 : 0
        anchors.topMargin: root.shadowEnabled ? 8 : 0
        anchors.bottomMargin: root.shadowEnabled ? -8 : 0
        radius: root.cornerRadius + 2
        color: "#26000000"
        opacity: root.shadowEnabled ? 1 : 0
    }

    Rectangle {
        anchors.fill: parent
        radius: root.cornerRadius
        color: root.tintColor
        opacity: root.glassOpacity
        border.width: 1
        border.color: root.borderColor
    }

    Rectangle {
        anchors {
            left: parent.left
            right: parent.right
            top: parent.top
        }
        height: Math.max(44, parent.height * 0.46)
        radius: root.cornerRadius
        opacity: 0.9
        gradient: Gradient {
            GradientStop { position: 0.0; color: "#66FFFFFF" }
            GradientStop { position: 0.38; color: "#18FFFFFF" }
            GradientStop { position: 1.0; color: "#00FFFFFF" }
        }
    }

    Rectangle {
        anchors {
            left: parent.left
            right: parent.right
            top: parent.top
        }
        height: 1
        anchors.leftMargin: root.cornerRadius * 0.75
        anchors.rightMargin: root.cornerRadius * 0.75
        color: "#D8FFFFFF"
        opacity: 0.62
    }

    Item {
        id: contentLayer
        anchors.fill: parent
    }
}
