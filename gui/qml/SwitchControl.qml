import QtQuick
import QtQuick.Layouts

Item {
    id: root

    property bool checked: false
    property string title: ""
    property string subtitle: ""
    property color accentColor: "#3B82F6"
    property color activeBackground: "#ECF4FF"
    property color inactiveBackground: "#78FFFFFF"
    property color textColor: "#172033"
    property color mutedTextColor: "#667386"

    signal toggled(bool checked)

    implicitWidth: 160
    implicitHeight: subtitle.length > 0 ? 66 : 46
    scale: mouse.pressed ? 0.99 : 1.0

    Behavior on scale {
        NumberAnimation { duration: 120; easing.type: Easing.OutCubic }
    }

    Rectangle {
        id: panel
        anchors.fill: parent
        radius: subtitle.length > 0 ? 18 : 14
        color: root.checked ? root.activeBackground : (mouse.containsMouse ? "#E8FFFFFF" : root.inactiveBackground)
        border.width: 1
        border.color: root.checked ? root.accentColor : "#8AFFFFFF"

        Behavior on color {
            ColorAnimation { duration: 160 }
        }
    }

    RowLayout {
        anchors.fill: parent
        anchors.leftMargin: 14
        anchors.rightMargin: 12
        anchors.topMargin: 10
        anchors.bottomMargin: 10
        spacing: 12

        ColumnLayout {
            Layout.fillWidth: true
            spacing: 2

            Text {
                Layout.fillWidth: true
                text: root.title
                color: root.textColor
                elide: Text.ElideRight
                verticalAlignment: Text.AlignVCenter
                font {
                    family: "Microsoft YaHei UI"
                    pixelSize: 13
                    weight: Font.DemiBold
                }
            }

            Text {
                Layout.fillWidth: true
                visible: root.subtitle.length > 0
                text: root.subtitle
                color: root.mutedTextColor
                elide: Text.ElideRight
                font {
                    family: "Microsoft YaHei UI"
                    pixelSize: 11
                }
            }
        }

        Rectangle {
            id: track
            Layout.preferredWidth: 48
            Layout.preferredHeight: 26
            radius: height / 2
            color: root.checked ? root.accentColor : "#B8C2D0"
            border.width: 1
            border.color: "#90FFFFFF"

            Behavior on color {
                ColorAnimation { duration: 160 }
            }

            Rectangle {
                width: 20
                height: 20
                radius: 10
                x: root.checked ? parent.width - width - 3 : 3
                anchors.verticalCenter: parent.verticalCenter
                color: "#FFFFFF"

                Behavior on x {
                    NumberAnimation { duration: 180; easing.type: Easing.OutCubic }
                }
            }
        }
    }

    MouseArea {
        id: mouse
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: Qt.PointingHandCursor
        onClicked: {
            root.checked = !root.checked
            root.toggled(root.checked)
        }
    }
}
